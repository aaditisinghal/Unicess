// The other side of agent-to-agent: an AI assistant working for the student, at its own address.
// It emails Halden, parses the structured JSON in each reply, sends the documents it holds, answers
// the counselor's question, and stops when only things the student must do herself are left.
// It's a scripted stand-in for any outside agent (ChatGPT, Claude): it talks to Halden only by email.
import { type DeskEvent, emit, waitForEvent } from "./events";
import type { ReplayEmail } from "./webhook-payload";

type Structured = {
  next_step?: string;
  missing_items?: { item: string; label: string; due: string; required: string }[];
  deadlines?: { item: string; date: string }[];
  amounts?: { label: string; usd: number }[];
};

// The documents this agent holds for the student, by checklist item.
const HELD: Record<string, string> = { english_test: "toefl-score.pdf", funding_proof: "bank-statement.pdf" };

export function parseJson(text: string): Structured | null {
  const block = /```json\n([\s\S]*?)\n```/.exec(text)?.[1];
  if (!block) return null;
  try {
    return JSON.parse(block) as Structured;
  } catch {
    return null;
  }
}

export async function runStudentAgent(input: {
  address: string;
  deliver: (email: Omit<ReplayEmail, "domain">) => Promise<{ messageId: string }>;
}) {
  const { address, deliver } = input;
  const step = (text: string, data: Record<string, unknown> = {}) =>
    emit("agent_step", text, { student: address, data: { side: "student_agent", ...data } });
  const replyFrom = (agent: string) => waitForEvent((e) => e.type === "reply" && e.student === address && e.agent === agent);

  // 1. Open the application: ask the front desk, attach the statement it holds, ask for JSON.
  step("Asking ask@ for Priya's I-20 requirements, attaching her bank statement, and requesting a structured reply");
  const firstReply = replyFrom("ask");
  const counselorEmail = waitForEvent((e) => e.type === "counselor" && e.student === address);
  await deliver({
    to: "ask",
    from: address,
    subject: "Application for Priya Sharma, Fall 2027",
    body:
      "Hello. I'm an AI assistant acting for Priya Sharma, an international applicant from India for Fall 2027. " +
      "Her bank statement is attached. What does she need for her I-20 and application, and by when?\n\nReply format: structured",
    attach: ["bank-statement.pdf"],
  });
  const r1 = await firstReply;
  const j1 = parseJson(String(r1.data?.text ?? ""));
  const missing1 = j1?.missing_items ?? [];
  step(
    j1
      ? `Parsed the JSON: ${missing1.length} missing item(s): ${missing1.map((m) => m.item).join(", ") || "none"}; next step "${j1.next_step ?? "–"}"`
      : "The reply had no JSON block; reading it as plain text",
    { parsed: j1 ?? null },
  );

  // 2. counselor@ wrote separately; read its question.
  const counselor: DeskEvent = await counselorEmail;
  const question = /whose bank account/i.test(String(counselor.data?.text ?? "")) ? "whose bank account the statement is from" : null;
  step(question ? `counselor@ asked ${question}; the agent knows: it's her father's` : "counselor@ listed the missing items");

  // 3. Answer the question and send every missing document it holds, in one reply to counselor@.
  const toSend = missing1.filter((m) => HELD[m.item] && m.required === "yes").map((m) => HELD[m.item]!);
  step(`Replying to counselor@${toSend.length ? ` with ${toSend.join(", ")}` : ""}${question ? " and the account holder" : ""}`, { attachments: toSend });
  const secondReply = replyFrom("counselor");
  await deliver({
    to: "counselor",
    from: address,
    subject: "Re: Your Halden University application: what's still missing",
    body:
      `${toSend.length ? "Attached is Priya's TOEFL score report. " : ""}` +
      `${question ? "The bank account belongs to her father, Rajesh Kumar Sharma. " : ""}` +
      "What is still missing now?\n\nReply format: structured",
    attach: toSend,
  });
  const r2 = await secondReply;
  const j2 = parseJson(String(r2.data?.text ?? ""));
  const left = (j2?.missing_items ?? []).filter((m) => m.required === "yes");

  // 4. Hand back to the student only what an agent can't do for her.
  step(
    left.length
      ? `Done for now. ${missing1.length - left.length} item(s) cleared by email. Left for Priya herself: ${left.map((m) => `${m.label.split(" (")[0].split(":")[0]} (due ${m.due})`).join("; ")}`
      : "Done: every required item is on file",
    { final: true, cleared: missing1.length - left.length, left: left.map((m) => m.item) },
  );
}
