// The portal's "Open a conversation with prospective students" button: ask@ starts a real conversation with the demo inbox, so a
// presenter can show the whole loop (email out, reply in, offices answer) without writing first.
// It only ever sends to DEMO_INBOX, so the public portal can't be used to email anyone else.
import { env } from "./env";
import { emit } from "./events";
import { mail } from "./primitive";

const MIN_GAP_MS = 20_000;
let lastSentAt = 0;

export const outreachTarget = () => env.demoInbox ?? null;

// The portal shows the address partly hidden: demo access is public.
export function maskEmail(address: string): string {
  const [local = "", domain = ""] = address.split("@");
  return `${local.slice(0, 1)}${"•".repeat(Math.min(8, Math.max(3, local.length - 1)))}@${domain}`;
}

// How long until another email may go out; 0 when it can go now.
export const waitBeforeNext = (now: number, last: number) => Math.max(0, last + MIN_GAP_MS - now);

export function outreachMessage(domain: string): { subject: string; text: string } {
  return {
    subject: "Halden University admissions: reply with any question",
    text: [
      "Hello from Halden University's admissions desk.",
      "",
      "Reply to this email with any question about admissions, international requirements, financial aid or housing. You can attach documents such as a talent showcase or a test score report. Each office answers its part, and you get one combined reply, relatively fast.",
      "",
      'Not sure what to ask? Try: "How can I maximise my career opportunities at Halden?"',
      "",
      `Halden University admissions 
      (ask@${domain})`,
    ].join("\n"),
  };
}

export async function sendOutreach(domain: string, now = Date.now()): Promise<{ ok: true; to: string; at: string } | { ok: false; error: string }> {
  const to = outreachTarget();
  if (!to) return { ok: false, error: "Set DEMO_INBOX in .env to the inbox that should receive this email." };
  const wait = waitBeforeNext(now, lastSentAt);
  if (wait > 0) return { ok: false, error: `An email went out moments ago. Wait ${Math.ceil(wait / 1000)} s before sending another.` };
  lastSentAt = now;

  const { subject, text } = outreachMessage(domain);
  try {
    const sent = (await mail().send(
      { from: `"Halden University" <ask@${domain}>`, to, subject, bodyText: text },
      { idempotencyKey: `outreach:${to}:${now}` },
    )) as { rejected?: string[] } | undefined;
    if (sent?.rejected?.some((r) => r.toLowerCase() === to)) throw new Error("the recipient was rejected");
  } catch (err) {
    lastSentAt = 0;
    return { ok: false, error: `Primitive didn't send it: ${err instanceof Error ? err.message.split("\n")[0] : err}` };
  }
  emit("outreach", `ask@ emailed ${maskEmail(to)} to start a conversation; a reply is answered like any applicant's email`, {
    student: to,
    agent: "ask",
    data: { subject },
    primitive: [`client.send({ from: ask@, to: ${maskEmail(to)}, subject: "${subject}" })`],
  });
  console.log(`[outreach] ask@ -> ${to}: "${subject}"`);
  return { ok: true, to: maskEmail(to), at: new Date(now).toISOString() };
}
