// Proactive reminders: counselor@ reads a student's file and emails them, unasked, about anything
// still missing that falls due soon. In production this runs once a day on a schedule; the demo
// passes a "today" so the calendar can be fast-forwarded.
import { type CaseFile, type ChecklistItem, caseKey, claimOutbound } from "./cases";
import { env } from "./env";
import { emit } from "./events";
import { readMemory } from "./memory";
import { mail } from "./primitive";

const DAY = 24 * 60 * 60 * 1000;
const WINDOW_DAYS = 21;

// Missing items due within the window (or overdue), soonest first, with calendar days left.
export function dueSoon(checklist: ChecklistItem[], today: Date) {
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  return checklist
    .filter((i) => i.status === "missing")
    .map((i) => ({ ...i, daysLeft: Math.round((Date.parse(i.deadline) - startOfToday) / DAY) }))
    .filter((i) => Number.isFinite(i.daysLeft) && i.daysLeft <= WINDOW_DAYS)
    .sort((a, b) => a.daysLeft - b.daysLeft);
}

export async function sendReminders(input: { student: string; today: Date; domain: string; dryRun?: boolean }) {
  const { student, today, domain } = input;
  const dryRun = input.dryRun ?? (env.dryRun || student.includes("@example.com"));
  const stored = await readMemory<CaseFile>(caseKey(student));
  if (!stored) throw new Error(`No case file for ${student}`);
  const caseFile = stored.value;

  const due = dueSoon(caseFile.checklist, today);
  const when = today.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
  if (due.length === 0) {
    emit("reminder", `${when}: counselor@ checked the file; nothing is due in the next ${WINDOW_DAYS} days`, {
      student,
      agent: "counselor",
      data: { today: today.toISOString(), items: [], sent: false },
    });
    return;
  }

  const firstName = String(caseFile.facts.student_name ?? "").split(/\s+/)[0];
  const label = (s: string) => s.split(" (")[0]!.split(":")[0];
  const lines = due.map((i) =>
    i.daysLeft < 0
      ? `- ${label(i.label)}: was due ${i.deadline} (overdue)`
      : `- ${label(i.label)}: due ${i.deadline}, ${i.daysLeft === 0 ? "today" : `in ${i.daysLeft} day${i.daysLeft === 1 ? "" : "s"}`}`,
  );
  const text = [
    `Hi${firstName ? ` ${firstName}` : ""},`,
    "",
    "A quick reminder from your Halden University application file. These are still missing and due soon:",
    "",
    ...lines,
    "",
    "Reply to this email with the documents attached and I'll update your file right away.",
    "",
    `Application Counselor (counselor@${domain})`,
    "Halden University",
  ].join("\n");
  const subject = `Reminder: ${label(due[0]!.label)} due ${due[0]!.deadline}`;

  if (!(await claimOutbound(student))) {
    emit("shield", "Case reached its 10-email cap; counselor@ didn't send the reminder", { student, agent: "counselor", data: { kind: "cap" } });
    return;
  }
  const key = `remind:${student}:${today.toISOString().slice(0, 10)}`;
  if (!dryRun) {
    await mail().send({ from: `"Halden University" <counselor@${domain}>`, to: student, subject, bodyText: text }, { idempotencyKey: key });
  }
  emit("reminder", `${when}: counselor@ emailed a reminder, unasked: ${due.map((i) => `${label(i.label)} in ${i.daysLeft} days`).join(", ")}`, {
    student,
    agent: "counselor",
    data: { today: today.toISOString(), items: due.map((i) => ({ label: label(i.label), deadline: i.deadline, daysLeft: i.daysLeft })), text, subject, sent: true, dryRun },
    primitive: [
      `memories.get("case/${student}"): checklist read`,
      `client.send({ from: counselor@, to: student, subject: "${subject}" }, { idempotencyKey: "remind:…:${today.toISOString().slice(0, 10)}" })${dryRun ? " (demo email: not sent)" : ""}`,
      "In production this runs daily on a schedule; the demo fast-forwards the date",
    ],
  });
}
