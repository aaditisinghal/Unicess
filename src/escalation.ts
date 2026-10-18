// Human escalation: an agent's draft goes to a staff counselor, and only an APPROVE (or an edited
// version) from an allowlisted, authenticated staff address sends anything to the student.
import type { ReceivedEmail } from "@primitivedotdev/sdk";
import { isTrustedSender } from "@primitivedotdev/sdk/api";
import { OFFICES } from "./agents";
import { type Agent, type Task, taskKey } from "./cases";
import { env } from "./env";
import { emit } from "./events";
import { createMemory, readMemory, updateMemory } from "./memory";
import { addLearned } from "./learned";
import { mail } from "./primitive";

export type Escalation = {
  ref: string; // <student email id>/<agent>, also quoted in the staff email's subject
  student: string;
  agent: Agent;
  request: string;
  draft: string;
  staff: string | null;
  domain: string;
  // The student's original email, so the approved answer lands in the same thread
  subject: string | null;
  messageId: string | null;
  references: string[];
  status: "waiting" | "approved" | "edited";
  // approval: a decision only staff can make. gap: a question the knowledge file couldn't answer.
  kind?: "approval" | "gap";
  createdAt: string;
  resolvedAt?: string;
};

export const escalationKey = (ref: string) => `escalation/${ref}`;
const isReplay = (ref: string) => ref.startsWith("replay_");

export async function escalate(input: {
  email: ReceivedEmail;
  student: string;
  agent: Agent;
  request: string;
  draft: string;
  domain: string;
  kind?: "approval" | "gap";
}): Promise<void> {
  const { email, student, agent, request, draft, domain } = input;
  const kind = input.kind ?? "approval";
  const ref = `${email.id}/${agent}`;
  const staff = env.staffAddresses[0] ?? null;
  const record: Escalation = {
    ref,
    student,
    agent,
    request,
    draft,
    staff,
    domain,
    subject: email.subject,
    messageId: email.thread.messageId,
    references: email.thread.references,
    status: "waiting",
    kind,
    createdAt: new Date().toISOString(),
  };
  // Create-only, so a webhook retry never sends staff a second copy.
  if (!(await createMemory(escalationKey(ref), record))) return;

  if (!staff) {
    console.warn(`[escalation] ${ref} is waiting, but STAFF_ADDRESSES is empty, so no counselor was emailed`);
    return;
  }
  const subject = `[${kind === "gap" ? "Answer needed" : "Approval needed"}] ${OFFICES[agent]}: request from ${student} (ref ${ref})`;
  const text = (
    kind === "gap"
      ? [
          `${student} asked: ${request}`,
          "",
          `${agent}@'s knowledge file doesn't answer this. Reply with the answer: it goes to the student, and ${agent}@ learns it, so the next student with this question is answered with no human.`,
        ]
      : [
          `${student} asked: ${request}`,
          "",
          "Reply APPROVE to send this draft to the student, or reply with your own version and that will be sent instead.",
          "",
          "--- Draft ---",
          draft,
          "--- End of draft ---",
        ]
  )
    .concat(["", `${OFFICES[agent]} agent (${agent}@${domain}), Halden University Campus Desk`])
    .join("\n");

  emit("escalation", kind === "gap" ? `Asked ${staff} for an answer ${agent}@ doesn't have: ${request}` : `Draft sent to ${staff} for approval: ${request}`, {
    student,
    agent,
    data: { ref, staff, draft, kind },
    primitive: [
      `memories.set("escalation/${ref.slice(0, 14)}…", if_absent): waiting_on_human`,
      `client.send({ from: ${agent}@, to: ${staff} })${env.dryRun || isReplay(ref) ? " (demo email: not sent)" : ""}`,
    ],
  });
  if (env.dryRun || isReplay(ref)) {
    console.log(`[dry-run] ${agent}@ -> ${staff} ("${subject}"):\n${text}`);
    return;
  }
  await mail().send(
    { from: `"Halden University" <${agent}@${domain}>`, to: staff, subject, bodyText: text },
    { idempotencyKey: `escalation:${ref}:to-staff` },
  );
  console.log(`[escalation] ${agent}@ -> ${staff}: draft for ${student} awaits approval`);
}

export async function handleStaffReply(email: ReceivedEmail, staff: string): Promise<void> {
  // The allowlist alone isn't enough: a From header is easy to forge, so the sender must also authenticate.
  const trust = isTrustedSender(email.raw, { domain: staff.split("@")[1], sender: staff });
  if (!trust.trusted) {
    console.warn(`[escalation] ignored mail from ${staff}: sender not authenticated (${trust.reason})`);
    emit("shield", `An APPROVE claiming to be from ${staff} failed sender authentication and was ignored`, {
      data: { kind: "forged_approval", detail: trust.reason },
      primitive: [`isTrustedSender(email, { sender: ${staff} }) → ${trust.reason}`],
    });
    return;
  }
  const ref = /\(ref ([^)\s]+)\)/.exec(email.subject ?? "")?.[1];
  const stored = ref ? await readMemory<Escalation>(escalationKey(ref)) : null;
  if (!ref || !stored) {
    console.warn(`[escalation] mail from ${staff} doesn't reply to an open escalation ("${email.subject}")`);
    return;
  }

  const reply = newText(email.text ?? "");
  const approved = /^approve\b/i.test(reply);
  if (!approved && !reply) {
    console.warn(`[escalation] ${ref}: empty reply from ${staff}; still waiting`);
    return;
  }
  const answer = approved ? stored.value.draft : reply;

  // Claim it, so two staff replies (or a retried delivery) can't both send.
  let claimed = false;
  const now = new Date().toISOString();
  await updateMemory<Escalation>(
    escalationKey(ref),
    () => stored.value,
    (current) => {
      claimed = current.status === "waiting";
      return claimed ? { ...current, status: approved ? "approved" : "edited", resolvedAt: now } : current;
    },
  );
  if (!claimed) {
    console.log(`[escalation] ${ref} was already resolved; ignoring the reply from ${staff}`);
    return;
  }

  const { student, agent, domain, subject, messageId, references } = stored.value;
  // A staff answer to a knowledge gap becomes part of that office's knowledge. Approvals never do.
  if (stored.value.kind === "gap" && !approved) {
    await addLearned(agent, { question: stored.value.request, answer: answer.trim(), from: staff, at: now });
    emit("learned", `${agent}@ learned a new answer from ${staff}: the next student who asks gets it with no human`, {
      student,
      agent,
      data: { question: stored.value.request, answer: answer.trim() },
      primitive: [`memories.set("knowledge/${agent}", if_version): learned answer appended`],
    });
  }
  const text = [answer.trim(), "", `${OFFICES[agent]} (${agent}@${domain})`, "Halden University"].join("\n");
  emit("approval", `${staff} ${approved ? "approved the draft" : "sent an edited answer"}; ${agent}@ replied to the student`, {
    student,
    agent,
    data: { ref, staff, status: approved ? "approved" : "edited", text },
    primitive: [
      `isTrustedSender(email, { domain: "${staff.split("@")[1]}", sender }) → trusted`,
      `memories.set("escalation/…", if_version): claimed once, status ${approved ? "approved" : "edited"}`,
      `client.send({ from: ${agent}@, to: student, thread: inReplyTo })${env.dryRun || isReplay(ref) ? " (demo email: not sent)" : ""}`,
    ],
  });
  if (env.dryRun || isReplay(ref)) {
    console.log(`[dry-run] ${agent}@ -> ${student} (${approved ? "approved" : "edited"} by ${staff}):\n${text}`);
  } else {
    await mail().send(
      {
        from: `"Halden University" <${agent}@${domain}>`,
        to: student,
        subject: subject?.toLowerCase().startsWith("re:") ? subject : `Re: ${subject ?? "your request"}`,
        bodyText: text,
        ...(messageId ? { thread: { inReplyTo: messageId, references: [...references, messageId] } } : {}),
      },
      { idempotencyKey: `escalation:${ref}:to-student` },
    );
    console.log(`[escalation] ${ref} ${approved ? "approved" : "edited"} by ${staff}; sent to ${student}`);
  }

  const [emailId] = ref.split("/");
  await updateMemory<Task | null>(
    taskKey(emailId, agent),
    () => null,
    (task) => (task ? { ...task, status: "done", updatedAt: now } : task),
  );
}

// The staff member's new text: everything above the quoted email.
export function newText(body: string): string {
  const lines: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (/^>/.test(line) || /^On .+wrote:\s*$/.test(line) || /^-+\s*(Draft|Original Message)/i.test(line)) break;
    lines.push(line);
  }
  return lines.join("\n").trim();
}
