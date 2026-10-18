import { type ReceivedEmail, validateEmailAuth } from "@primitivedotdev/sdk";
import { answerEmail } from "./answer";
import { readAttachments } from "./attachments";
import { type Agent, type CaseFile, caseKey, claimOutbound, createTasks, isAgent, recordInbound } from "./cases";
import { refreshChecklist } from "./checklist";
import { sendMissingItems } from "./counselor";
import { env } from "./env";
import { handleStaffReply } from "./escalation";
import { emit, rememberCase, setDomain } from "./events";
import { createMemory, updateMemory } from "./memory";
import { mail } from "./primitive";
import { routeEmail } from "./router";
import { buildStructuredReply, structuredBlock, wantsStructuredReply } from "./structured";

const SEVEN_DAYS = 7 * 24 * 60 * 60;
// Subject of the task emails ask@ sends to departments: "[Task <email id>] ..."
const TASK_SUBJECT = /^\[Task [^\]]+\]/;

// Raw RFC 822 headers of the email, when Primitive included the raw message inline.
export function rawHeaders(email: ReceivedEmail): string {
  const raw = (email.raw.email as { content?: { raw?: { included?: boolean; data?: string } } }).content?.raw;
  if (!raw?.included || !raw.data) return "";
  const text = Buffer.from(raw.data, "base64").toString("utf8");
  return text.slice(0, text.search(/\r?\n\r?\n/) >>> 0);
}

// Auto-replies (out-of-office, mailing lists, bounces) never get an answer, or two bots reply forever.
// Auto-Submitted isn't in the parsed payload's headers, so it's read from the raw message.
export function autoReplyReason(email: ReceivedEmail): string | null {
  const headers = rawHeaders(email);
  const autoSubmitted = /^Auto-Submitted:\s*([^\r\n]+)/im.exec(headers)?.[1]?.trim().toLowerCase();
  if (autoSubmitted && autoSubmitted !== "no") return `Auto-Submitted: ${autoSubmitted}`;
  if (/^Precedence:\s*(bulk|junk|list|auto_reply)/im.test(headers)) return "Precedence: bulk";
  if (/^X-Autoreply:/im.test(headers) || /^X-Autorespond:/im.test(headers)) return "X-Autoreply header";
  if (/^(auto(matic)?[ -]?reply|out of (the )?office|undeliverable|delivery status notification)/i.test(email.subject ?? "")) return "auto-reply subject";
  return null;
}

export async function handleInbound(email: ReceivedEmail): Promise<void> {
  const startedAt = Date.now();
  const sender = email.sender.address.toLowerCase();
  const recipient = email.receivedBy.toLowerCase();
  const [localPart, ourDomain] = recipient.split("@");
  setDomain(ourDomain);

  // Primitive retries deliveries with the same event id; the create-only write lets exactly one through.
  if (!(await createMemory(`seen/${email.eventId}`, true, SEVEN_DAYS))) {
    console.log(`[skip] duplicate delivery ${email.eventId}`);
    emit("shield", "Duplicate webhook delivery skipped, so no second reply", {
      student: sender,
      data: { kind: "duplicate" },
      primitive: [`memories.set("seen/${email.eventId.slice(0, 12)}…", if_absent) → 409, already seen`],
    });
    return;
  }

  // Time to first reply is measured from when Primitive received the email.
  const receivedAt = Date.parse(email.receivedAt);
  const clockStart = Number.isFinite(receivedAt) && receivedAt <= startedAt ? receivedAt : startedAt;

  // Mail between our own addresses: ask@'s task emails to departments are the coordination record,
  // never a student. Anything else from our own domain is ignored, so two agents can't loop.
  if (sender.endsWith(`@${ourDomain}`)) {
    if (TASK_SUBJECT.test(email.subject ?? "")) {
      emit("handoff", `${localPart}@ received its task from ${sender.split("@")[0]}@ over Primitive`, {
        agent: localPart,
        data: { delivered: true, subject: email.subject },
        primitive: [`webhook email.received ${sender} → ${recipient}`],
      });
    } else {
      console.log(`[skip] ${sender} -> ${recipient}: sent from one of our own addresses`);
      emit("skip", `Ignored mail from our own address ${sender}`, { agent: localPart });
    }
    return;
  }

  const autoReply = autoReplyReason(email);
  if (autoReply) {
    emit("shield", `Auto-reply from ${sender} ignored (${autoReply}), so no reply loop`, {
      student: sender,
      data: { kind: "auto_reply" },
      primitive: ["raw message headers read from the email.received payload"],
    });
    return;
  }

  // A counselor's reply approves or edits an escalation; it never opens a student case.
  if (env.staffAddresses.includes(sender)) {
    await handleStaffReply(email, sender);
    return;
  }

  // Replayed test emails (scripts/replay.ts, the dashboard) don't exist in Primitive, so nothing is sent for them.
  const dryRun = env.dryRun || email.id.startsWith("replay_");
  const body = email.text ?? "";
  const agent: Agent = isAgent(localPart) ? localPart : "ask";

  // A sender that fails SPF/DKIM/DMARC might be someone else using the student's address:
  // answer general questions only, and never read or write their case file.
  const auth = validateEmailAuth(email.auth);
  if (auth.verdict === "suspicious") {
    await answerGenerally({ email, sender, recipient, agent, body, dryRun, ourDomain, startedAt: clockStart, reasons: auth.reasons });
    return;
  }

  const before = await recordInbound(email, sender, recipient);
  emit(
    "inbound",
    `"${email.subject ?? "(no subject)"}"${email.attachments.length ? ` with ${email.attachments.length} attachment(s)` : ""}`,
    {
      student: sender,
      agent: localPart,
      data: { subject: email.subject, attachments: email.attachments.map((a) => a.filename) },
      primitive: [
        "primitive.receive(): Primitive-Signature verified",
        `memories.set("seen/…", if_absent): first delivery`,
        `memories.set("case/${sender}", if_version): email added to the shared file`,
      ],
    },
  );

  // The student is answering a question an agent asked them: pick that task back up.
  const resumed = before.waitingOn && before.waitingOn.agent === agent ? before.waitingOn : null;
  if (resumed) {
    emit("resume", `${agent}@ resumed its task: the student answered "${resumed.question}"`, {
      student: sender,
      agent,
      data: { question: resumed.question, waitedMs: Date.now() - Date.parse(resumed.since) },
      primitive: [`memories.get("case/${sender}") → waitingOn ${agent}@`],
    });
  }

  // ask@ (or an unknown address) splits the email across departments; a department address answers alone.
  // Attachments are read at the same time, so documents don't add to the wait.
  const [routed, documents] = await Promise.all([
    agent === "ask" ? routeEmail(email.subject, body) : null,
    readAttachments(email, sender).catch((err) => {
      console.warn("[attachments] failed:", err instanceof Error ? err.message : err);
      return [];
    }),
  ]);
  const work = routed
    ? routed.map((t) => ({ agent: t.department as Agent, question: t.question }))
    : [{ agent, question: resumed ? `The student answered your question "${resumed.question}". ${body.slice(0, 400)}` : body.slice(0, 500) }];
  // Funding proof and English scores are intl@'s to check, even when the question doesn't name them.
  if (agent === "ask" && documents.some((d) => d.kind !== "other") && !work.some((w) => w.agent === "intl")) {
    work.push({ agent: "intl", question: "Check the attached documents against the requirements." });
  }
  await createTasks(email, sender, work);
  if (agent === "ask") {
    emit("route", `Split into tasks for ${work.map((w) => `${w.agent}@`).join(", ")}`, {
      student: sender,
      agent,
      data: { agents: work.map((w) => w.agent) },
      primitive: work.map((w) => `memories.set("task/${email.id.slice(0, 14)}…/${w.agent}", if_absent)`),
    });
    handOff({ email, sender, ourDomain, work, dryRun });
  }

  // Agents see the checklist with any document from this email already marked received.
  const caseFile = await refreshChecklist(sender);
  rememberCase(caseFile);
  console.log(
    `[case] ${sender}: email ${caseFile.emails.length} on file, ${documents.length} document(s) read, tasks for ${work.map((w) => `${w.agent}@`).join(", ")}`,
  );

  // An office that misses the 30 s cut answers in a second email in the same thread.
  const onLate = async (late: Agent, section: string) => {
    const text = `Follow-up from ${late}@${ourDomain}\n\n${section.trim()}\n\n${late}@${ourDomain}, Halden University`;
    if (!(await claimOutbound(sender))) return;
    const key = `${email.eventId}:${late}:late`;
    if (!dryRun) await mail().reply(email, { text, from: `"Halden University" <${late}@${ourDomain}>` }, { idempotencyKey: key });
    const ms = Date.now() - clockStart;
    emit("followup", `${late}@ sent its late answer as a follow-up in the same thread, ${(ms / 1000).toFixed(1)} s after the email arrived${dryRun ? " (test, not sent)" : ""}`, {
      student: sender,
      agent: late,
      data: { ms, text, dryRun },
      primitive: [`client.reply(email, { from: ${late}@ }, { idempotencyKey: "…:${late}:late" })${dryRun ? " (demo email: not sent)" : ""}`],
    });
  };
  const answer = await answerEmail({ email, student: sender, body, caseFile, work, domain: ourDomain, onLate });

  // Facts from this email (e.g. "the account is my father's") can change what's required.
  let updated = await refreshChecklist(sender);
  if (resumed) {
    updated = await updateMemory<CaseFile>(caseKey(sender), () => updated, (c) => ({ ...c, waitingOn: undefined }));
  }
  rememberCase(updated);
  const open = updated.checklist.filter((i) => i.status !== "received" && i.status !== "not_needed");
  console.log(`[checklist] ${sender}: ${updated.checklist.map((i) => `${i.item}=${i.status}`).join(", ")}`);
  emit("checklist", `${updated.checklist.filter((i) => i.status === "received").length} received, ${open.length} open`, {
    student: sender,
    data: { items: updated.checklist },
  });

  // An AI agent writing for the student can ask for a reply it can parse.
  let text = answer.text;
  let attachments: { filename: string; content_type: string; content_base64: string }[] | undefined;
  if (wantsStructuredReply(email.subject, body)) {
    const json = await buildStructuredReply({ sections: answer.sections, nextStep: answer.nextStep, caseFile: updated, domain: ourDomain });
    text = `${text}\n\n${structuredBlock(json)}`;
    attachments = [
      {
        filename: "unicess-reply.json",
        content_type: "application/json",
        content_base64: Buffer.from(JSON.stringify(json, null, 2)).toString("base64"),
      },
    ];
    console.log(
      `[structured] ${sender}: ${json.deadlines.length} deadlines, ${json.requirements.length} requirements, ${json.amounts.length} amounts, ${json.missing_items.length} missing items`,
    );
  }

  // Loop guard: past 10 emails in one case, a human takes over instead of the agents.
  if (!(await claimOutbound(sender))) {
    emit("shield", `Case reached its 10-email cap; ${agent}@ stopped replying and flagged it for a human`, {
      student: sender,
      agent,
      data: { kind: "cap" },
      primitive: [`memories.set("case/${sender}", if_version): outbound count at cap`],
    });
    return;
  }

  const idempotencyKey = `${email.eventId}:${agent}:answer`;
  if (dryRun) {
    console.log(`[dry-run] ${agent}@ -> ${sender} after ${Date.now() - startedAt} ms:\n${text}`);
  } else {
    // The key makes a webhook retry of this event return the first reply instead of sending a second.
    await mail().reply(
      email,
      { text, from: `"Halden University" <${recipient}>`, ...(attachments ? { attachments } : {}) },
      { idempotencyKey },
    );
    console.log(`[reply] ${agent}@ -> ${sender}: first reply in ${Date.now() - startedAt} ms`);
  }
  const ms = Date.now() - clockStart;
  emit("reply", `${agent}@ replied in ${(ms / 1000).toFixed(1)} s${attachments ? " with a structured JSON block" : ""}${dryRun ? " (test, not sent)" : ""}`, {
    student: sender,
    agent,
    data: { ms, escalated: answer.escalated, structured: !!attachments, dryRun, text },
    primitive: [
      `client.reply(email, { from: ${agent}@ }, { idempotencyKey: "${idempotencyKey.slice(0, 18)}…" })${dryRun ? " (demo email: not sent)" : ""}`,
      "In-Reply-To / References set by the SDK, so it lands in the student's thread",
      ...(attachments ? ["attachment: unicess-reply.json"] : []),
    ],
  });

  // After ask@'s first answer, counselor@ starts its own thread listing what's still missing.
  if (agent === "ask" && open.length > 0) {
    await sendMissingItems({ caseFile: updated, domain: ourDomain, eventId: email.eventId, dryRun });
  }
}

// ask@ hands each department its task as a real Primitive email between our own addresses, so the
// coordination is on record in Primitive's mail store. The work itself runs here in parallel, so the
// student never waits on that delivery.
function handOff(input: { email: ReceivedEmail; sender: string; ourDomain: string; work: { agent: Agent; question: string }[]; dryRun: boolean }) {
  const { email, sender, ourDomain, work, dryRun } = input;
  for (const { agent, question } of work) {
    const to = `${agent}@${ourDomain}`;
    emit("handoff", `ask@ → ${agent}@: ${question}`, {
      student: sender,
      agent,
      data: { to, dryRun },
      primitive: [`client.send({ from: ask@, to: ${agent}@, subject: "[Task …]" })${dryRun ? " (demo email: not sent)" : ""}`],
    });
    if (dryRun) continue;
    mail()
      .send(
        {
          from: `"Halden University Front Desk" <ask@${ourDomain}>`,
          to,
          subject: `[Task ${email.id}] ${question.slice(0, 120)}`,
          bodyText: `Task from ask@ for ${agent}@\n\nStudent: ${sender}\nOriginal subject: ${email.subject ?? "(none)"}\n\nYour part:\n${question}\n\nWrite your section into task/${email.id}/${agent}; ask@ merges the reply.`,
        },
        { idempotencyKey: `${email.eventId}:handoff:${agent}` },
      )
      .catch((err) => console.warn(`[handoff] ask@ -> ${agent}@ failed: ${err instanceof Error ? err.message : err}`));
  }
}

// For a sender that failed authentication: general answers from the knowledge files, no case file.
async function answerGenerally(input: {
  email: ReceivedEmail;
  sender: string;
  recipient: string;
  agent: Agent;
  body: string;
  dryRun: boolean;
  ourDomain: string;
  startedAt: number;
  reasons: string[];
}) {
  const { email, sender, recipient, agent, body, dryRun, ourDomain, startedAt, reasons } = input;
  const now = new Date().toISOString();
  const blank: CaseFile = { student: sender, status: "open", facts: {}, checklist: [], emails: [], createdAt: now, updatedAt: now };
  emit("inbound", `"${email.subject ?? "(no subject)"}" (unverified sender)`, {
    student: sender,
    agent,
    data: { subject: email.subject, attachments: [], unverified: true },
  });
  emit("shield", `${sender} failed sender authentication; answering with general information only`, {
    student: sender,
    agent,
    data: { kind: "spoofed", detail: reasons.join("; ") },
    primitive: [`validateEmailAuth(email.auth) → suspicious (${reasons[0] ?? "DMARC/SPF failed"})`],
  });
  const routed = agent === "ask" ? await routeEmail(email.subject, body) : null;
  const work = routed ? routed.map((t) => ({ agent: t.department as Agent, question: t.question })) : [{ agent, question: body.slice(0, 500) }];
  if (agent === "ask") emit("route", `Split into tasks for ${work.map((w) => `${w.agent}@`).join(", ")}`, { student: sender, agent, data: { agents: work.map((w) => w.agent) } });
  const answer = await answerEmail({ email, student: sender, body, caseFile: blank, work, domain: ourDomain, saveToCase: false });
  const text = `${answer.text}\n\nFor your security we couldn't verify this email came from ${sender}, so this answer doesn't include anything from your application file.`;
  if (!dryRun) {
    await mail().reply(email, { text, from: `"Halden University" <${recipient}>` }, { idempotencyKey: `${email.eventId}:${agent}:general` });
  }
  emit("reply", `${agent}@ replied with general information only${dryRun ? " (test, not sent)" : ""}`, {
    student: sender,
    agent,
    data: { ms: Date.now() - startedAt, escalated: false, dryRun, text, general: true },
  });
}
