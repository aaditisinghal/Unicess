// counselor@: emails the student every missing item with its deadline, right after ask@'s first reply.
// The student's reply lands at counselor@, where the usual flow reads the documents and confirms what's still open.
import { type CaseFile, caseKey } from "./cases";
import { openItems } from "./checklist";
import { updateMemory } from "./memory";
import { mail } from "./primitive";

export async function sendMissingItems(input: {
  caseFile: CaseFile;
  domain: string;
  eventId: string;
  dryRun: boolean;
}): Promise<void> {
  const { caseFile, domain, eventId, dryRun } = input;
  if (caseFile.missingItemsSentAt) return;
  const open = openItems(caseFile.checklist);
  if (open.length === 0) return;

  const firstName = String(caseFile.facts.student_name ?? "").split(/\s+/)[0];
  const lines = open.map((i) =>
    i.status === "if_parent"
      ? `- ${i.label}, if the bank account is a parent's: due ${i.deadline}`
      : `- ${i.label}: due ${i.deadline}`,
  );
  const askAboutAccount = open.some((i) => i.status === "if_parent");
  const text = [
    `Hi${firstName ? ` ${firstName}` : ""},`,
    "",
    "I'm the application counselor for your Halden University file. Here is what's still missing:",
    "",
    ...lines,
    "",
    askAboutAccount
      ? "Reply to this email with the documents attached, and tell me whose bank account the statement is from. I'll update your file right away."
      : "Reply to this email with the documents attached, and I'll update your file right away.",
    "",
    `Application Counselor (counselor@${domain})`,
    "Halden University",
  ].join("\n");
  const subject = "Your Halden University application: what's still missing";

  if (dryRun) {
    console.log(`[dry-run] counselor@ -> ${caseFile.student} (new thread, "${subject}"):\n${text}`);
  } else {
    await mail().send(
      { from: `"Halden University" <counselor@${domain}>`, to: caseFile.student, subject, bodyText: text },
      { idempotencyKey: `${eventId}:counselor:missing` },
    );
    console.log(`[counselor] missing-items email -> ${caseFile.student}: ${open.map((i) => i.item).join(", ")}`);
  }

  await updateMemory<CaseFile>(
    caseKey(caseFile.student),
    () => caseFile,
    (current) => ({ ...current, status: "waiting", missingItemsSentAt: new Date().toISOString() }),
  );
}
