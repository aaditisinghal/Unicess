// Runs the department agents in parallel, saves their sections, and merges them into one reply.
import type { ReceivedEmail } from "@primitivedotdev/sdk";
import { OFFICES, type StudentFacts, runAgent, writeNextStep } from "./agents";
import { REQUEST_UNDER_REVIEW, UNDER_REVIEW, WAIVER_DRAFT, approvalByModel, approvalByRule, approvalReason } from "./approval";
import { type Agent, type CaseFile, type Task, type TaskStatus, caseKey, taskKey } from "./cases";
import { escalate } from "./escalation";
import { emit } from "./events";
import { updateMemory } from "./memory";

// The combined reply goes out at this cut. An office still working keeps going (up to the hard limit)
// and its answer follows as a second email in the same thread, so nothing waits on the slowest office.
const SECTION_DEADLINE_MS = Number(process.env.SECTION_CUT_MS) || 30_000;
const LATE_LIMIT_MS = 90_000;
const ORDER: Agent[] = ["intl", "admissions", "finaid", "housing", "counselor", "ask"];

type Work = { agent: Agent; question: string };
type Result = { agent: Agent; section: string | null; facts: StudentFacts | null; escalated: boolean };

export async function answerEmail(input: {
  email: ReceivedEmail;
  student: string;
  body: string;
  caseFile: CaseFile;
  work: Work[];
  domain: string;
  // false for an unverified sender: answer, but never write to their case file or escalate.
  saveToCase?: boolean;
  // Called with an office's answer that arrived after the combined reply went out.
  onLate?: (agent: Agent, section: string) => Promise<void>;
}): Promise<{ text: string; nextStep: string; escalated: boolean; sections: { agent: Agent; section: string | null }[] }> {
  const { email, student, body, caseFile, work, domain } = input;
  const save = input.saveToCase !== false;
  const hardLimit = AbortSignal.timeout(LATE_LIMIT_MS);
  let cutPassed = false;

  const runOne = async ({ agent, question }: Work): Promise<Result> => {
    try {
      // The office answers while the fast model screens its part of the email; the check never holds the answer long.
      const [out, check] = await Promise.all([
        runAgent({ agent, question, subject: email.subject, body, caseFile, signal: hardLimit }),
        approvalByModel(question, AbortSignal.any([hardLimit, AbortSignal.timeout(8_000)])),
      ]);
      // A request only staff may grant goes to them if any layer says so: the office's flag, the rule, or the check.
      const rule = approvalByRule(agent, question, `${email.subject ?? ""}\n${body}`);
      const why = approvalReason({ agentFlag: out.needs_human, rule, check });
      if (why) {
        // Without a draft from the office, staff approve its own answer; a waiver gets the standard approval text.
        out.draft_if_approved ??= rule === "fee waiver" ? WAIVER_DRAFT : out.section;
        out.needs_human = true;
        if (!/\b(counsel|review|human|staff)/i.test(out.section)) out.section = rule === "fee waiver" ? UNDER_REVIEW : REQUEST_UNDER_REVIEW;
      }
      // Two reasons to bring in a human: a decision only staff can make, or a question the knowledge file can't answer.
      const kind = out.needs_human && out.draft_if_approved ? "approval" : out.knowledge_gap ? "gap" : null;
      const escalated = save && kind !== null;
      const status = escalated ? "waiting_on_human" : "done";
      if (save) await saveSection({ emailId: email.id, student, agent, question }, out.section, status);
      emit("post", out.section, {
        student,
        agent,
        data: { status, emailId: email.id, question, late: cutPassed },
        primitive: save ? [`memories.set("task/${email.id.slice(0, 14)}…/${agent}", if_version): section saved, status ${status}`] : [],
      });
      // A request only a human can grant: the student hears it's being reviewed; staff get the draft.
      // If staff can't be emailed, the student's answer still goes out; the escalation stays waiting.
      if (escalated) {
        await escalate({ email, student, agent, request: question, draft: out.draft_if_approved ?? out.section, domain, kind: kind!, reason: kind === "approval" ? (why ?? undefined) : undefined }).catch((err) => {
          const reason = err instanceof Error ? err.message.split("\n")[0] : String(err);
          console.warn(`[escalation] couldn't email staff for ${agent}@: ${reason}`);
          emit("escalation", `Couldn't email staff: ${reason}`, { student, agent, data: { failed: true } });
        });
      }
      return { agent, section: out.section, facts: out.facts, escalated };
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(`[agent] ${agent}@ gave no answer: ${reason}`);
      emit("post", `No answer from ${agent}@ in time; the reply points the student to ${agent}@ directly.`, {
        student,
        agent,
        data: { status: "missed", emailId: email.id, question, reason },
      });
      return { agent, section: null, facts: null, escalated: false };
    }
  };

  const runs = work.map((w) => ({ work: w, promise: runOne(w) }));
  const cut = new Promise<null>((resolve) => setTimeout(() => resolve(null), SECTION_DEADLINE_MS));
  const settled = await Promise.all(runs.map((r) => Promise.race([r.promise, cut])));
  cutPassed = true;
  const results: Result[] = settled.map((r, i) => r ?? { agent: runs[i]!.work.agent, section: null, facts: null, escalated: false });

  // Offices still working at the cut: say so in the reply, and send their answer when it arrives.
  runs.forEach((run, i) => {
    if (settled[i]) return;
    const { agent } = run.work;
    emit("post", `Still working at the 30 s cut; ${agent}@'s answer will follow in the same thread.`, {
      student,
      agent,
      data: { status: "pending_late", emailId: email.id, question: run.work.question },
    });
    run.promise.then(async (late) => {
      if (!late.section) return;
      if (save && late.facts) await mergeFacts(student, [late.facts]).catch(() => {});
      await input.onLate?.(agent, late.section).catch((err) => console.warn(`[answer] follow-up from ${agent}@ failed: ${err instanceof Error ? err.message : err}`));
    });
  });

  if (save) await mergeFacts(student, results.flatMap((r) => (r.facts ? [r.facts] : [])));

  const sorted = [...results].sort((a, b) => ORDER.indexOf(a.agent) - ORDER.indexOf(b.agent));
  const signed = sorted.map(({ agent, section }) => {
    const heading = `${OFFICES[agent]} (${agent}@${domain})`;
    return section
      ? `${heading}\n${section.trim()}`
      : `${heading}\nThis office is still working on your question; its answer will follow in this thread. You can also write to ${agent}@${domain} directly.`;
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
    text: [nextStep, ...signed, "Halden University · Unicess"].join("\n\n"),
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
