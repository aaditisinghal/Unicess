import type { ReceivedEmail } from "@primitivedotdev/sdk";
import { answerEmail } from "./answer";
import { readAttachments } from "./attachments";
import { type Agent, createTasks, isAgent, recordInbound } from "./cases";
import { refreshChecklist } from "./checklist";
import { sendMissingItems } from "./counselor";
import { env } from "./env";
import { handleStaffReply } from "./escalation";
import { emit, rememberCase, setDomain } from "./events";
import { createMemory } from "./memory";
import { mail } from "./primitive";
import { routeEmail } from "./router";
import { buildStructuredReply, structuredBlock, wantsStructuredReply } from "./structured";

const SEVEN_DAYS = 7 * 24 * 60 * 60;

export async function handleInbound(email: ReceivedEmail): Promise<void> {
  const startedAt = Date.now();

  // Primitive retries deliveries with the same event id; the create-only write lets exactly one through.
  if (!(await createMemory(`seen/${email.eventId}`, true, SEVEN_DAYS))) {
    console.log(`[skip] duplicate delivery ${email.eventId}`);
    return;
  }

  const sender = email.sender.address.toLowerCase();
  const recipient = email.receivedBy.toLowerCase();
  const [localPart, ourDomain] = recipient.split("@");
  setDomain(ourDomain);
  // Time to first reply is measured from when Primitive received the email.
  const receivedAt = Date.parse(email.receivedAt);
  const clockStart = Number.isFinite(receivedAt) && receivedAt <= startedAt ? receivedAt : startedAt;

  // Never answer our own addresses: that is how two agents end up replying to each other forever.
  if (sender.endsWith(`@${ourDomain}`)) {
    console.log(`[skip] ${sender} -> ${recipient}: sent from one of our own addresses`);
    emit("skip", `Ignored mail from our own address ${sender}`, { agent: localPart });
    return;
  }

  // A counselor's reply approves or edits an escalation; it never opens a student case.
  if (env.staffAddresses.includes(sender)) {
    await handleStaffReply(email, sender);
    return;
  }

  await recordInbound(email, sender, recipient);
  emit(
    "inbound",
    `"${email.subject ?? "(no subject)"}"${email.attachments.length ? ` with ${email.attachments.length} attachment(s)` : ""}`,
    { student: sender, agent: localPart, data: { subject: email.subject, attachments: email.attachments.map((a) => a.filename) } },
  );
  const body = email.text ?? "";
  // Replayed test emails (scripts/replay.ts) don't exist in Primitive, so nothing is sent for them.
  const dryRun = env.dryRun || email.id.startsWith("replay_");

  // ask@ (or an unknown address) splits the email across departments; a department address answers alone.
  // Attachments are read at the same time, so documents don't add to the wait.
  const agent: Agent = isAgent(localPart) ? localPart : "ask";
  const [routed, documents] = await Promise.all([
    agent === "ask" ? routeEmail(email.subject, body) : null,
    readAttachments(email, sender).catch((err) => {
      console.warn("[attachments] failed:", err instanceof Error ? err.message : err);
      return [];
    }),
  ]);
  const work = routed
    ? routed.map((t) => ({ agent: t.department as Agent, question: t.question }))
    : [{ agent, question: body.slice(0, 500) }];
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
    });
  }

  // Agents see the checklist with any document from this email already marked received.
  const caseFile = await refreshChecklist(sender);
  rememberCase(caseFile);
  console.log(
    `[case] ${sender}: email ${caseFile.emails.length} on file, ${documents.length} document(s) read, tasks for ${work.map((w) => `${w.agent}@`).join(", ")}`,
  );

  const answer = await answerEmail({ email, student: sender, body, caseFile, work, domain: ourDomain });

  // Facts from this email (e.g. "the account is my father's") can change what's required.
  const updated = await refreshChecklist(sender);
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
        filename: "campus-desk-reply.json",
        content_type: "application/json",
        content_base64: Buffer.from(JSON.stringify(json, null, 2)).toString("base64"),
      },
    ];
    console.log(
      `[structured] ${sender}: ${json.deadlines.length} deadlines, ${json.requirements.length} requirements, ${json.amounts.length} amounts, ${json.missing_items.length} missing items`,
    );
  }

  if (dryRun) {
    console.log(`[dry-run] ${agent}@ -> ${sender} after ${Date.now() - startedAt} ms:\n${text}`);
  } else {
    // The key makes a webhook retry of this event return the first reply instead of sending a second.
    await mail().reply(
      email,
      { text, from: `"Halden University" <${recipient}>`, ...(attachments ? { attachments } : {}) },
      { idempotencyKey: `${email.eventId}:${agent}:answer` },
    );
    console.log(`[reply] ${agent}@ -> ${sender}: first reply in ${Date.now() - startedAt} ms`);
  }
  const ms = Date.now() - clockStart;
  emit("reply", `${agent}@ replied in ${(ms / 1000).toFixed(1)} s${attachments ? " with a structured JSON block" : ""}${dryRun ? " (test, not sent)" : ""}`, {
    student: sender,
    agent,
    data: { ms, escalated: answer.escalated, structured: !!attachments, dryRun, text },
  });

  // After ask@'s first answer, counselor@ starts its own thread listing what's still missing.
  if (agent === "ask" && open.length > 0) {
    await sendMissingItems({ caseFile: updated, domain: ourDomain, eventId: email.eventId, dryRun });
  }
}
