import type { ReceivedEmail } from "@primitivedotdev/sdk";
import { env } from "./env";
import { mail } from "./primitive";

// Build step 2 moves this to Primitive Memories (seen/<event id>) so it survives restarts.
const seenEvents = new Set<string>();

export async function handleInbound(email: ReceivedEmail): Promise<void> {
  const startedAt = Date.now();
  if (seenEvents.has(email.eventId)) return;
  seenEvents.add(email.eventId);

  const sender = email.sender.address.toLowerCase();
  const recipient = email.receivedBy.toLowerCase();
  const [agent, ourDomain] = recipient.split("@");

  // Never answer our own addresses: that is how two agents end up replying to each other forever.
  if (sender.endsWith(`@${ourDomain}`)) {
    console.log(`[skip] ${sender} -> ${recipient}: sent from one of our own addresses`);
    return;
  }

  const text = [
    `Hi, this is ${agent}@ at Halden University.`,
    "",
    `We received your email "${email.subject ?? "(no subject)"}", and a full answer is on its way.`,
    "",
    "(Campus Desk build step 1: echo reply.)",
  ].join("\n");

  if (env.dryRun) {
    console.log(`[dry-run] ${agent}@ -> ${sender}:\n${text}`);
    return;
  }

  // The key makes a webhook retry of this event return the first reply instead of sending a second.
  await mail().reply(email, { text }, { idempotencyKey: `${email.eventId}:${agent}:echo` });
  console.log(`[reply] ${agent}@ -> ${sender} in ${Date.now() - startedAt} ms`);
}
