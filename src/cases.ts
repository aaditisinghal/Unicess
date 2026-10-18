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
  createdAt: string;
  updatedAt: string;
};

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
