// counselor@: emails the student every missing item with its deadline, right after ask@'s first reply.
// The student's reply lands at counselor@, where the usual flow reads the documents and confirms what's still open.
import { type CaseFile, caseKey, claimOutbound } from "./cases";
import { openItems } from "./checklist";
import { emit } from "./events";
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
  // Ask whose account it is only once a statement is on file; before that the sponsor letter is just "if needed".
  const statementOnFile = caseFile.checklist.some((i) => i.item === "funding_proof" && i.status === "received");
  const askAboutAccount = statementOnFile && open.some((i) => i.status === "if_parent");
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
  if (!(await claimOutbound(caseFile.student))) {
    emit("shield", "Case reached its 10-email cap; counselor@ didn't send its missing-items email", {
      student: caseFile.student,
      agent: "counselor",
      data: { kind: "cap" },
    });
    return;
  }

  if (dryRun) {
    console.log(`[dry-run] counselor@ -> ${caseFile.student} (new thread, "${subject}"):\n${text}`);
  } else {
    await mail().send(
      { from: `"Halden University" <counselor@${domain}>`, to: caseFile.student, subject, bodyText: text },
      { idempotencyKey: `${eventId}:counselor:missing` },
    );
    console.log(`[counselor] missing-items email -> ${caseFile.student}: ${open.map((i) => i.item).join(", ")}`);
  }
  emit("counselor", `Emailed what's missing: ${open.map((i) => i.label.split(" (")[0].split(":")[0]).join("; ")}${dryRun ? " (test, not sent)" : ""}`, {
    student: caseFile.student,
    agent: "counselor",
    data: { items: open, text },
    primitive: [
      `client.send({ from: counselor@, to: student, subject: "${subject}" }, { idempotencyKey })${dryRun ? " (demo email: not sent)" : ""}`,
    ],
  });
  const question = "Whose bank account is the statement from?";
  if (askAboutAccount) {
    emit("ask_back", `counselor@ asked the student: "${question}" and is waiting for the answer`, {
      student: caseFile.student,
      agent: "counselor",
      data: { question },
      primitive: [`memories.set("case/${caseFile.student}", if_version): waitingOn counselor@`],
    });
  }

  await updateMemory<CaseFile>(
    caseKey(caseFile.student),
    () => caseFile,
    (current) => ({
      ...current,
      status: "waiting",
      missingItemsSentAt: new Date().toISOString(),
      ...(askAboutAccount ? { waitingOn: { agent: "counselor" as const, question, since: new Date().toISOString() } } : {}),
    }),
  );
}
