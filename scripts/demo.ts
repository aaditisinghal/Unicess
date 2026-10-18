// Replays the whole demo script against the local server, in order, waiting on the dashboard's own
// events between steps. Nothing is sent: replayed emails are answered in the log only.
// Usage: npm run demo   (with the dev server running)
import { execFileSync } from "node:child_process";
import { env } from "../src/env";

const STUDENT = "student@example.com";
const AGENT = "priya-agent@helper-bot.primitive.email";
// Replayed mail only authenticates as example.com, so the replayed approval must come from this test address.
const TEST_STAFF = "staff@example.com";
if (!env.staffAddresses.includes(TEST_STAFF)) {
  throw new Error(`Add ${TEST_STAFF} to STAFF_ADDRESSES (after the real counselor) so the replayed approval is accepted`);
}
const base = `http://localhost:${env.port}`;
const token = env.dashboardToken;
if (!token) throw new Error("Set DASHBOARD_TOKEN in .env; the demo waits on the dashboard's events");

type Event = { id: number; type: string; student?: string; data?: Record<string, unknown> };
let since = 0;

async function events(): Promise<Event[]> {
  const res = await fetch(`${base}/api/state?since=${since}&token=${encodeURIComponent(token!)}`);
  const state = (await res.json()) as { lastId: number; events: Event[] };
  since = state.lastId;
  return state.events;
}

async function waitFor(what: string, match: (e: Event) => boolean, timeoutMs = 90_000): Promise<Event> {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const hit = (await events()).find(match);
    if (hit) return hit;
    await new Promise((r) => setTimeout(r, 1000));
  }
  throw new Error(`timed out waiting for ${what}`);
}

function run(script: string, ...args: string[]) {
  execFileSync(process.execPath, ["--import", "tsx", `scripts/${script}`, ...args], { stdio: "inherit" });
}

async function step(title: string, args: string[], waitFor_: [string, (e: Event) => boolean]) {
  console.log(`\n== ${title}`);
  await events(); // move the cursor past older events
  run("replay.ts", ...args);
  const hit = await waitFor(...waitFor_);
  console.log(`   done: ${hit.type}${typeof hit.data?.ms === "number" ? ` in ${((hit.data.ms as number) / 1000).toFixed(1)} s` : ""}`);
  return hit;
}

run("reset.ts", STUDENT);
run("reset.ts", AGENT);

await step("Step 2: question + bank statement to ask@", ["--attach", "bank-statement.pdf"], [
  "counselor's missing-items email",
  (e) => e.type === "counselor" && e.student === STUDENT,
]);

await step(
  "Step 6: reply to counselor@ with the TOEFL report",
  [
    "--to", "counselor",
    "--subject", "Re: Your Halden University application: what's still missing",
    "--body", "Here is my TOEFL score report. The bank account is my father's.\\n\\nPriya",
    "--attach", "toefl-score.pdf",
  ],
  ["counselor's reply", (e) => e.type === "reply" && e.student === STUDENT],
);

await step(
  "Step 7: email finaid@ directly",
  ["--to", "finaid", "--subject", "Scholarships", "--body", "Do you have any scholarships I could get, and how much would I still need to cover?\\n\\nPriya"],
  ["finaid's reply", (e) => e.type === "reply" && e.student === STUDENT],
);

// Wait for the student's "under review" reply, not just the escalation, so the approval never lands first.
await step(
  "Step 8: fee-waiver request to ask@",
  ["--subject", "Application fee waiver", "--body", "Could I get the application fee waived? Paying $75 is hard for my family right now.\\n\\nPriya"],
  ["the student's under-review reply", (e) => e.type === "reply" && e.student === STUDENT && e.data?.escalated === true],
);
const all = await fetch(`${base}/api/state?since=0&token=${encodeURIComponent(token)}`).then((r) => r.json() as Promise<{ events: Event[] }>);
const escalation = all.events.filter((e) => e.type === "escalation" && e.student === STUDENT).at(-1);
if (!escalation) throw new Error("finaid@ didn't escalate the waiver; check the server log");
await step(
  "Step 8: staff counselor replies APPROVE",
  [
    "--from", TEST_STAFF,
    "--to", "finaid",
    "--subject", `Re: [Approval needed] Financial Aid: request from ${STUDENT} (ref ${escalation.data?.ref})`,
    "--body", "APPROVE",
  ],
  ["the approval", (e) => e.type === "approval" && e.student === STUDENT],
);

await step(
  "Step 9: the student's AI agent asks intl@ for a structured reply",
  [
    "--from", AGENT,
    "--to", "intl",
    "--subject", "Deadlines and requirements for Priya Sharma",
    "--body", "I'm an AI assistant acting for Priya Sharma, an international applicant from India for Fall 2027. What are the I-20 funding and English test requirements and deadlines?\\n\\nReply format: structured",
  ],
  ["intl's structured reply", (e) => e.type === "reply" && e.student === AGENT],
);

console.log("\nDemo replay finished. Reset with: npm run reset -- student@example.com");
