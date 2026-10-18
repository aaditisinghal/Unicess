import assert from "node:assert/strict";
import { test } from "node:test";
import { REQUEST_UNDER_REVIEW, UNDER_REVIEW, WAIVER_DRAFT, approvalByModel, approvalByRule, approvalReason } from "../src/approval";
import type { Agent } from "../src/cases";

const rule = (agent: Agent, text: string) => approvalByRule(agent, text, text);

test("a waiver, affordability help, a refund, more time or an exception needs a human, at any office", () => {
  const cases: [Agent, string, string][] = [
    ["finaid", "Can the application fee be waived due to financial hardship?", "fee waiver"],
    ["finaid", "Could I get a fee waiver?", "fee waiver"],
    ["finaid", "Is there an application fee reduction for low-income students?", "fee waiver"],
    ["admissions", "I can't afford the $75 application fee.", "affordability"],
    ["admissions", "We cannot pay the fee this month.", "affordability"],
    ["housing", "Can I pay the housing deposit later?", "affordability"],
    ["finaid", "Is there a payment plan for tuition?", "affordability"],
    ["housing", "Can I get a refund of my housing deposit?", "refund"],
    ["admissions", "Could I have a short extension on the transcript deadline?", "deadline extension"],
    ["admissions", "Can I submit my transcript after the deadline?", "deadline extension"],
    ["intl", "Could you give me more time to send the sponsor letter?", "deadline extension"],
    ["intl", "Can you make an exception to the TOEFL requirement for me?", "exception to a rule"],
    ["admissions", "Please waive the requirement for a second recommendation letter.", "exception to a rule"],
  ];
  for (const [agent, text, reason] of cases) assert.equal(rule(agent, text), reason, text);
});

test("questions about rules and options stay with the office, including the demo's policy questions", () => {
  const cases: [Agent, string][] = [
    ["finaid", "Do you have any scholarships I could get, and how much would I still need to cover?"],
    ["admissions", "If I'm admitted for Fall 2027, can I defer my start to Spring 2028?"],
    ["housing", "How much is the housing deposit?"],
    ["housing", "Is the housing deposit refundable?"],
    ["admissions", "What is the application deadline?"],
    ["intl", "How much do I need to show for my I-20, and can I get on-campus housing?"],
    ["admissions", "Which file extension should my transcript scan use?"],
  ];
  for (const [agent, text] of cases) assert.equal(rule(agent, text), null, text);
});

test("finaid@ sees a money request anywhere in the email; other offices see only their own part", () => {
  const email = "Here is my bank statement. Also, could the application fee be waived?";
  assert.equal(approvalByRule("finaid", "What scholarships can I get?", email), "fee waiver");
  assert.equal(approvalByRule("intl", "Check the bank statement for the I-20.", email), null);
  // Extensions and exceptions belong to the office they were asked of; they don't spill over to finaid@.
  assert.equal(approvalByRule("finaid", "What scholarships can I get?", "Can I have an extension on my transcript?"), null);
});

test("any one layer is enough, and the reason names every layer that said yes", () => {
  assert.equal(approvalReason({ agentFlag: false, rule: null, check: null }), null);
  assert.equal(approvalReason({ agentFlag: true, rule: null, check: null }), "office policy, flagged by the agent");
  assert.equal(approvalReason({ agentFlag: false, rule: null, check: "a payment plan" }), "request check: a payment plan");
  assert.equal(
    approvalReason({ agentFlag: true, rule: "refund", check: "a deposit refund" }),
    "keyword rule: refund; request check: a deposit refund; office policy, flagged by the agent",
  );
});

test("the request check reports the model's answer, and fails open when the model is unavailable", async () => {
  const says = (needs: boolean, reason = "") => (async () => ({ needs_approval: needs, reason })) as never;
  assert.equal(await approvalByModel("Can I pay in two parts?", undefined, says(true, "a split payment")), "a split payment");
  assert.equal(await approvalByModel("Can I pay in two parts?", undefined, says(true)), "a decision only staff can make");
  assert.equal(await approvalByModel("What is the deadline?", undefined, says(false)), null);
  const down = (async () => {
    throw new Error("429 busy");
  }) as never;
  assert.equal(await approvalByModel("Can I pay in two parts?", undefined, down), null);
});

test("staff get a draft to approve, and the student hears it's under review", () => {
  assert.match(WAIVER_DRAFT, /approved/);
  assert.match(UNDER_REVIEW, /counselor for review/);
  assert.match(REQUEST_UNDER_REVIEW, /counselor for review/);
});
