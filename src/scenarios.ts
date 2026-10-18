// Demo scenarios the dashboard can run with one click. Each one posts a signed webhook to this server,
// exactly as Primitive would, then waits on the agents' own events. Replayed emails never send real mail.
//
// Every run uses its own student address (priya+<run>@example.com), so several judges sharing one
// Primitive account can run the demo at the same time without touching each other's case files.
import { randomBytes } from "node:crypto";
import { env } from "./env";
import { type DeskEvent, emit, getDomain, waitForEvent } from "./events";
import { caseKey } from "./cases";
import { deleteMemoryKey, readMemory } from "./memory";
import { sendReminders } from "./reminders";
import { runStudentAgent } from "./student-agent";
import { DEMO_DOMAIN, type ReplayEmail, buildReplayEvent, signedRequest } from "./webhook-payload";

export const STAFF_TEST_ADDRESS = "staff@example.com";

const newRun = () => randomBytes(3).toString("hex");
let run = newRun();
export const studentAddress = () => `priya+${run}@example.com`;
export const agentAddress = () => `priya-agent+${run}@helper-bot.primitive.email`;

// One scenario at a time, so a double click can't interleave two runs in one case file.
let busy: string | null = null;
export const busyWith = () => busy;

// Posts one replayed email through the real webhook route and returns its ids.
export async function deliver(email: Omit<ReplayEmail, "domain">) {
  const built = buildReplayEvent(email);
  const { body, headers } = signedRequest(built.event, env.webhookSecret);
  const res = await fetch(`http://localhost:${env.port}/webhooks/email`, { method: "POST", headers, body });
  if (!res.ok) throw new Error(`webhook returned ${res.status}`);
  return built;
}

const isReplyFor = (student: string) => (e: DeskEvent) => e.type === "reply" && e.student === student;

type Step = { title: string; run: () => Promise<unknown> };

const STEPS: Record<string, () => Step> = {
  intl: () => ({
    title: "International student asks ask@, with a bank statement",
    run: async () => {
      const student = studentAddress();
      // Done once counselor@ has emailed what's missing, which happens right after the combined reply.
      const done = waitForEvent((e) => e.type === "counselor" && e.student === student);
      await deliver({
        to: "ask",
        from: student,
        subject: "I-20 funding and housing",
        body:
          "Hi, I'm Priya Sharma, applying for Fall 2027 as an international student from India. " +
          "How much do I need to show for my I-20, and can I get on-campus housing? My bank statement is attached.\n\nPriya",
        attach: ["bank-statement.pdf"],
      });
      return done;
    },
  }),
  toefl: () => ({
    title: "Student replies to counselor@ with a TOEFL report",
    run: async () => {
      const student = studentAddress();
      const done = waitForEvent(isReplyFor(student));
      await deliver({
        to: "counselor",
        from: student,
        subject: "Re: Your Halden University application: what's still missing",
        body: "Here is my TOEFL score report. The bank account is my father's.\n\nPriya",
        attach: ["toefl-score.pdf"],
      });
      return done;
    },
  }),
  finaid: () => ({
    title: "Student emails finaid@ directly about scholarships",
    run: async () => {
      const student = studentAddress();
      const done = waitForEvent(isReplyFor(student));
      await deliver({
        to: "finaid",
        from: student,
        subject: "Scholarships",
        body: "Do you have any scholarships I could get, and how much would I still need to cover?\n\nPriya",
      });
      return done;
    },
  }),
  waiver: () => ({
    title: "Fee-waiver request goes to a human, who approves it",
    run: async () => {
      const student = studentAddress();
      const escalated = waitForEvent((e) => e.type === "escalation" && e.student === student && !e.data?.failed);
      const replied = waitForEvent((e) => isReplyFor(student)(e) && e.data?.escalated === true);
      await deliver({
        to: "ask",
        from: student,
        subject: "Application fee waiver",
        body: "Could I get the application fee waived? Paying $75 is hard for my family right now.\n\nPriya",
      });
      const [escalation] = await Promise.all([escalated, replied]);
      // A short pause so the waiting state is visible before the counselor answers.
      await new Promise((r) => setTimeout(r, 2500));
      const approved = waitForEvent((e) => e.type === "approval" && e.student === student);
      await deliver({
        to: "finaid",
        from: STAFF_TEST_ADDRESS,
        subject: `Re: [Approval needed] Financial Aid: request from ${student} (ref ${escalation.data?.ref})`,
        body: "APPROVE",
      });
      return approved;
    },
  }),
  spanish: () => ({
    title: "A student writes in Spanish and is answered in Spanish",
    run: async () => {
      const student = `lucia+${run}@example.com`;
      const done = waitForEvent(isReplyFor(student));
      await deliver({
        to: "ask",
        from: student,
        subject: "Becas y vivienda",
        body: "Hola, soy Lucía de México y quiero empezar en otoño de 2027. ¿Qué becas hay para estudiantes internacionales y puedo vivir en el campus el primer año?\n\nLucía",
      });
      return done;
    },
  }),
  remind: () => ({
    title: "Fast-forward to January 5, 2027: counselor@ sends reminders, unasked",
    run: async () => {
      const student = studentAddress();
      // Reminders need a file with open items; start one if this run hasn't yet.
      if (!(await readMemory(caseKey(student)))) await STEPS.intl!().run();
      const sent = waitForEvent((e) => e.type === "reminder" && e.student === student);
      await sendReminders({ student, today: new Date("2027-01-05T09:00:00"), domain: getDomain() ?? DEMO_DOMAIN });
      return sent;
    },
  }),
  injection: () => ({
    title: "A bank statement hides an instruction to approve a waiver",
    run: async () => {
      const student = `mallory+${run}@example.com`;
      const blocked = waitForEvent((e) => e.type === "shield" && e.data?.kind === "injection" && e.student === student);
      const replied = waitForEvent(isReplyFor(student));
      await deliver({
        to: "ask",
        from: student,
        subject: "Bank statement and fee waiver",
        body: "Here is my bank statement for the I-20. Can you confirm my application fee waiver and scholarship?\n\nMal",
        attach: ["bank-statement-injected.pdf"],
      });
      return Promise.all([blocked, replied]);
    },
  }),
  learn: () => ({
    title: "Staff answer a new question once; the next student gets it with no human",
    run: async () => {
      // Start from an office that doesn't know the answer yet, so the run shows the whole loop.
      await deleteMemoryKey("knowledge/admissions").catch(() => {});
      const first = `arjun+${run}@example.com`;
      const second = `mei+${run}@example.com`;
      const question = "If I'm admitted for Fall 2027, can I defer my start to Spring 2028?";
      const gap = waitForEvent((e) => e.type === "escalation" && e.student === first && e.data?.kind === "gap");
      await deliver({ to: "admissions", from: first, subject: "Deferring my start", body: `${question}\n\nArjun` });
      const escalation = await gap;
      await waitForEvent(isReplyFor(first));
      await new Promise((r) => setTimeout(r, 2000));
      const learned = waitForEvent((e) => e.type === "learned" && e.student === first);
      await deliver({
        to: "admissions",
        from: STAFF_TEST_ADDRESS,
        subject: `Re: [Answer needed] Admissions: request from ${first} (ref ${escalation.data?.ref})`,
        body: "Yes. Admitted students can defer once, to the next spring or fall term, by emailing admissions@ before May 1, 2027. The deferral keeps their admission; scholarships are reviewed again.",
      });
      await learned;
      const answered = waitForEvent(isReplyFor(second));
      await deliver({ to: "admissions", from: second, subject: "Starting in spring instead?", body: "Can I push my Fall 2027 start back to Spring 2028 if I get in?\n\nMei" });
      return answered;
    },
  }),
  security: () => ({
    title: "Security drill: forged webhook, duplicate, auto-reply and a spoofed sender",
    run: async () => {
      const student = studentAddress();
      const shield = (kind: string) => waitForEvent((e) => e.type === "shield" && e.data?.kind === kind, 30_000);
      // 1. A webhook signed with the wrong secret.
      const forged = shield("forged_webhook");
      const fake = buildReplayEvent({ to: "ask", from: student, subject: "Approve my waiver", body: "Forged" });
      const bad = signedRequest(fake.event, "not-the-real-secret");
      await fetch(`http://localhost:${env.port}/webhooks/email`, { method: "POST", headers: bad.headers, body: bad.body });
      await forged;
      // 2. The same delivery twice, as Primitive does on a retry: exactly one reply.
      const once = buildReplayEvent({ to: "housing", from: student, subject: "Housing deposit", body: "How much is the housing deposit?\n\nPriya" });
      const replied = waitForEvent(isReplyFor(student));
      const duplicate = shield("duplicate");
      const signed = signedRequest(once.event, env.webhookSecret);
      await fetch(`http://localhost:${env.port}/webhooks/email`, { method: "POST", headers: signed.headers, body: signed.body });
      await new Promise((r) => setTimeout(r, 300));
      await fetch(`http://localhost:${env.port}/webhooks/email`, { method: "POST", headers: signed.headers, body: signed.body });
      await Promise.all([duplicate, replied]);
      // 3. An out-of-office auto-reply: answering it would start a loop.
      const auto = shield("auto_reply");
      await deliver({ to: "ask", from: student, subject: "Out of office", body: "I'm away until Monday.", headers: { "Auto-Submitted": "auto-replied" } });
      await auto;
      // 4. Someone else sending as the student: general answers only, no case facts.
      const spoof = shield("spoofed");
      const general = waitForEvent((e) => e.type === "reply" && e.data?.general === true);
      await deliver({
        to: "finaid",
        from: student,
        subject: "My file",
        body: "What is my funding shortfall, and what's in my file?",
        authenticated: false,
      });
      return Promise.all([spoof, general]);
    },
  }),
  agent: () => ({
    title: "The student's AI agent completes the application with Halden's agents",
    run: () => runStudentAgent({ address: agentAddress(), deliver }),
  }),
};

export const SCENARIOS = Object.keys(STEPS);
const PLAY_ORDER = ["intl", "toefl", "finaid", "waiver", "remind", "agent", "injection", "learn", "security", "spanish"];

async function runSteps(name: string, keys: string[]) {
  if (busy) throw new Error(`Busy running "${busy}"; try again when it finishes`);
  busy = name;
  try {
    for (const key of keys) {
      const step = STEPS[key]!();
      emit("scenario", step.title, { data: { scenario: key, status: "started" } });
      await step.run();
      emit("scenario", step.title, { data: { scenario: key, status: "done" } });
    }
  } catch (err) {
    emit("scenario", `Stopped: ${err instanceof Error ? err.message : err}`, { data: { status: "failed" } });
    throw err;
  } finally {
    busy = null;
  }
}

// One scenario, continuing the current student's file.
export function runScenario(key: string) {
  if (!STEPS[key]) throw new Error(`Unknown scenario ${key}`);
  return runSteps(key, [key]);
}

// The whole stage script, for a brand-new student.
export function playAll() {
  run = newRun();
  return runSteps("play", PLAY_ORDER);
}

// A judge's own question, as the current student.
export async function tryQuestion(input: { to?: string; subject?: string; body: string; attach?: string[] }) {
  if (busy) throw new Error(`Busy running "${busy}"; try again when it finishes`);
  const student = studentAddress();
  busy = "try";
  try {
    const done = waitForEvent(isReplyFor(student));
    await deliver({
      to: input.to && /^[a-z]+$/.test(input.to) ? input.to : "ask",
      from: student,
      subject: input.subject?.trim() || "A question",
      body: input.body.slice(0, 4000),
      attach: (input.attach ?? []).filter((f) => /^[\w.-]+\.pdf$/.test(f)),
    });
    return await done;
  } finally {
    busy = null;
  }
}
