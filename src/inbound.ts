import type { ReceivedEmail } from "@primitivedotdev/sdk";
import { type Agent, createTasks, isAgent, recordInbound } from "./cases";
import { env } from "./env";
import { createMemory } from "./memory";
import { mail } from "./primitive";
import { routeEmail } from "./router";

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

  // A counselor's reply approves or edits an escalation (build step 5); it must never open a student case.
  if (env.staffAddresses.includes(sender)) {
    console.log(`[staff] ${sender} -> ${recipient}: escalation replies are handled in build step 5`);
    return;
  }

  const caseFile = await recordInbound(email, sender, recipient);
  const body = email.text ?? "";

  // ask@ (or an unknown address) splits the email across departments; a department address answers alone.
  const agent: Agent = isAgent(localPart) ? localPart : "ask";
  const work =
    agent === "ask"
      ? (await routeEmail(email.subject, body)).map((t) => ({ agent: t.department as Agent, question: t.question }))
      : [{ agent, question: body.slice(0, 500) }];
  await createTasks(email, sender, work);
  console.log(
    `[case] ${sender}: email ${caseFile.emails.length} on file, tasks for ${work.map((w) => `${w.agent}@`).join(", ")}`,
  );

  // Build step 3 replaces this acknowledgement with the merged answer.
  const text = [
    `Hi, this is ${agent}@ at Halden University.`,
    "",
    `Your question is with ${work.map((w) => `${w.agent}@`).join(", ")}. A combined answer follows shortly.`,
    "",
    "(Campus Desk build step 2: routing.)",
  ].join("\n");

  // Replayed test emails (scripts/replay.ts) don't exist in Primitive, so they are logged instead of answered.
  if (env.dryRun || email.id.startsWith("replay_")) {
    console.log(`[dry-run] ${agent}@ -> ${sender}:\n${text}`);
    return;
  }

  // The key makes a webhook retry of this event return the first reply instead of sending a second.
  await mail().reply(email, { text }, { idempotencyKey: `${email.eventId}:${agent}:ack` });
  console.log(`[reply] ${agent}@ -> ${sender} in ${Date.now() - startedAt} ms`);
}
