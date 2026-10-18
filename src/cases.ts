// The case file: one per student, keyed by their email address, shared by every agent.
import type { ReceivedEmail } from "@primitivedotdev/sdk";
import type { StudentDocument } from "./attachments";
import { createMemory, updateMemory } from "./memory";

export const AGENTS = ["ask", "admissions", "intl", "finaid", "housing", "counselor"] as const;
export type Agent = (typeof AGENTS)[number];
// Departments the ask@ router can hand work to. counselor@ runs after the reply instead (build step 5).
export const DEPARTMENTS = ["admissions", "intl", "finaid", "housing"] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const isAgent = (name: string): name is Agent => (AGENTS as readonly string[]).includes(name);

export type ChecklistItem = {
  item: string;
  label: string;
  deadline: string;
  // if_parent: needed only if the funding account belongs to a parent, which isn't known yet
  status: "missing" | "received" | "not_needed" | "if_parent";
  sourceEmailId?: string;
};

export type CaseFile = {
  student: string;
  status: "open" | "waiting" | "closed";
  facts: Record<string, unknown>;
  checklist: ChecklistItem[];
  emails: { id: string; to: string; subject: string | null; at: string }[];
  documents?: StudentDocument[];
  // When counselor@ last emailed the student what's missing (build step 5)
  missingItemsSentAt?: string;
  // An agent's open question to the student; the student's next email to that agent resumes it.
  waitingOn?: { agent: Agent; question: string; since: string };
  // Emails sent to this student, for the 10-per-case loop guard.
  outbound?: number;
  createdAt: string;
  updatedAt: string;
};

// Loop guard from the design doc: a case never gets more than this many emails from us.
export const MAX_OUTBOUND_PER_CASE = 10;

// Counts one more outbound email for the case. Returns false (and counts nothing) once the cap is reached.
export async function claimOutbound(student: string): Promise<boolean> {
  let allowed = false;
  await updateMemory<CaseFile>(
    caseKey(student),
    () => {
      throw new Error(`case file for ${student} disappeared`);
    },
    (current) => {
      allowed = (current.outbound ?? 0) < MAX_OUTBOUND_PER_CASE;
      return allowed ? { ...current, outbound: (current.outbound ?? 0) + 1 } : current;
    },
  );
  return allowed;
}

export type TaskStatus = "queued" | "working" | "waiting_on_student" | "waiting_on_human" | "done";

export type Task = {
  emailId: string;
  student: string;
  agent: Agent;
  question: string;
  status: TaskStatus;
  section?: string;
  createdAt: string;
  updatedAt: string;
};

export const caseKey = (student: string) => `case/${student.toLowerCase()}`;
export const taskKey = (emailId: string, agent: Agent) => `task/${emailId}/${agent}`;

export async function recordInbound(email: ReceivedEmail, student: string, recipient: string): Promise<CaseFile> {
  const now = new Date().toISOString();
  return updateMemory<CaseFile>(
    caseKey(student),
    () => ({ student, status: "open", facts: {}, checklist: [], emails: [], createdAt: now, updatedAt: now }),
    (current) =>
      current.emails.some((e) => e.id === email.id)
        ? current
        : {
            ...current,
            status: "open",
            emails: [...current.emails, { id: email.id, to: recipient, subject: email.subject, at: email.receivedAt }],
            updatedAt: now,
          },
  );
}

// Create-only, so a webhook retry of the same email never duplicates or resets a task.
export async function createTasks(email: ReceivedEmail, student: string, work: { agent: Agent; question: string }[]) {
  const now = new Date().toISOString();
  await Promise.all(
    work.map(({ agent, question }) =>
      createMemory(taskKey(email.id, agent), {
        emailId: email.id,
        student,
        agent,
        question,
        status: "queued",
        createdAt: now,
        updatedAt: now,
      } satisfies Task),
    ),
  );
}
