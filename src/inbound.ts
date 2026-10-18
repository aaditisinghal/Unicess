import type { ReceivedEmail } from "@primitivedotdev/sdk";
import { answerEmail } from "./answer";
import { readAttachments } from "./attachments";
import { type Agent, createTasks, isAgent, recordInbound } from "./cases";
import { refreshChecklist } from "./checklist";
import { sendMissingItems } from "./counselor";
import { env } from "./env";
import { handleStaffReply } from "./escalation";
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

  // Never answer our own addresses: that is how two agents end up replying to each other forever.
  if (sender.endsWith(`@${ourDomain}`)) {
    console.log(`[skip] ${sender} -> ${recipient}: sent from one of our own addresses`);
    return;
  }

  // A counselor's reply approves or edits an escalation; it never opens a student case.
  if (env.staffAddresses.includes(sender)) {
    await handleStaffReply(email, sender);
    return;
  }

  await recordInbound(email, sender, recipient);
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

  // Agents see the checklist with any document from this email already marked received.
  const caseFile = await refreshChecklist(sender);
  console.log(
    `[case] ${sender}: email ${caseFile.emails.length} on file, ${documents.length} document(s) read, tasks for ${work.map((w) => `${w.agent}@`).join(", ")}`,
  );

  const answer = await answerEmail({ email, student: sender, body, caseFile, work, domain: ourDomain });

  // Facts from this email (e.g. "the account is my father's") can change what's required.
  const updated = await refreshChecklist(sender);
  const open = updated.checklist.filter((i) => i.status !== "received" && i.status !== "not_needed");
  console.log(`[checklist] ${sender}: ${updated.checklist.map((i) => `${i.item}=${i.status}`).join(", ")}`);

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

  // After ask@'s first answer, counselor@ starts its own thread listing what's still missing.
  if (agent === "ask" && open.length > 0) {
    await sendMissingItems({ caseFile: updated, domain: ourDomain, eventId: email.eventId, dryRun });
  }
}
