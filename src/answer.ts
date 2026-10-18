// Runs the department agents in parallel, saves their sections, and merges them into one reply.
import type { ReceivedEmail } from "@primitivedotdev/sdk";
import { OFFICES, type StudentFacts, runAgent, writeNextStep } from "./agents";
import { type Agent, type CaseFile, type Task, type TaskStatus, caseKey, taskKey } from "./cases";
import { escalate } from "./escalation";
import { emit } from "./events";
import { updateMemory } from "./memory";

// A section not ready by then is left out and the student is pointed to that office instead.
const SECTION_DEADLINE_MS = 30_000;
const ORDER: Agent[] = ["intl", "admissions", "finaid", "housing", "counselor", "ask"];

type Work = { agent: Agent; question: string };

export async function answerEmail(input: {
  email: ReceivedEmail;
  student: string;
  body: string;
  caseFile: CaseFile;
  work: Work[];
  domain: string;
}): Promise<{ text: string; nextStep: string; escalated: boolean; sections: { agent: Agent; section: string | null }[] }> {
  const { email, student, body, caseFile, work, domain } = input;
  const deadline = AbortSignal.timeout(SECTION_DEADLINE_MS);

  const results = await Promise.all(
    work.map(async ({ agent, question }) => {
      try {
        const out = await runAgent({ agent, question, subject: email.subject, body, caseFile, signal: deadline });
        const escalated = out.needs_human && !!out.draft_if_approved;
        const status = escalated ? "waiting_on_human" : "done";
        await saveSection({ emailId: email.id, student, agent, question }, out.section, status);
        emit("post", out.section, { student, agent, data: { status, emailId: email.id, question } });
        // A request only a human can grant: the student hears it's being reviewed; staff get the draft.
        if (escalated) await escalate({ email, student, agent, request: question, draft: out.draft_if_approved!, domain });
        return { agent, section: out.section, facts: out.facts, escalated };
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[agent] ${agent}@ missed the reply: ${reason}`);
        emit("post", `Missed the reply: ${reason}`, { student, agent, data: { status: "missed", emailId: email.id, question } });
        return { agent, section: null, facts: null, escalated: false };
      }
    }),
  );

  await mergeFacts(student, results.flatMap((r) => (r.facts ? [r.facts] : [])));

  const sorted = [...results].sort((a, b) => ORDER.indexOf(a.agent) - ORDER.indexOf(b.agent));
  const signed = sorted.map(({ agent, section }) => {
    const heading = `${OFFICES[agent]} (${agent}@${domain})`;
    return section
      ? `${heading}\n${section.trim()}`
      : `${heading}\nThis office's answer isn't ready yet. Write to ${agent}@${domain} directly and they will reply.`;
  });

  const answered = sorted.filter((r) => r.section).map((r) => r.section).join("\n\n");
  let nextStep = "Next step: read each office's note below, and reply to that office's address with any follow-up.";
  if (answered) {
    try {
      nextStep = `Next step: ${await writeNextStep(answered, AbortSignal.timeout(10_000))}`;
    } catch (err) {
      console.warn(`[answer] next step skipped: ${err instanceof Error ? err.message : err}`);
    }
  }

  return {
    text: [nextStep, ...signed, "Halden University, Campus Desk"].join("\n\n"),
    nextStep,
    escalated: results.some((r) => r.escalated),
    sections: sorted.map(({ agent, section }) => ({ agent, section })),
  };
}

// The saved section is the agent's post on the case's internal thread (shown on the dashboard).
async function saveSection(
  task: Pick<Task, "emailId" | "student" | "agent" | "question">,
  section: string,
  status: TaskStatus,
) {
  const now = new Date().toISOString();
  await updateMemory<Task>(
    taskKey(task.emailId, task.agent),
    () => ({ ...task, status: "queued", createdAt: now, updatedAt: now }),
    (current) => ({ ...current, status, section, updatedAt: now }),
  );
}

// Only non-null facts are written, so one office never erases what another learned.
async function mergeFacts(student: string, found: StudentFacts[]) {
  const learned: Record<string, unknown> = {};
  for (const facts of found) {
    for (const [key, value] of Object.entries(facts)) if (value !== null) learned[key] = value;
  }
  if (Object.keys(learned).length === 0) return;
  await updateMemory<CaseFile>(
    caseKey(student),
    () => {
      throw new Error(`case file for ${student} disappeared`);
    },
    (current) => ({ ...current, facts: { ...current.facts, ...learned }, updatedAt: new Date().toISOString() }),
  );
}
