import assert from "node:assert/strict";
import { test } from "node:test";
import { UNDER_REVIEW, WAIVER_DRAFT, requiresApproval } from "../src/approval";

test("a fee waiver sent to finaid@ always needs a human, however it's worded", () => {
  for (const t of [
    "Can the application fee be waived due to financial hardship?",
    "Could I get a fee waiver?",
    "Is there an application fee reduction for low-income students?",
  ]) {
    assert.ok(requiresApproval("finaid", t), t);
  }
});

test("only finaid@ escalates waivers; other questions don't", () => {
  assert.equal(requiresApproval("admissions", "Can the application fee be waived?"), false);
  assert.equal(requiresApproval("finaid", "What scholarships can I get, and how much would I still need?"), false);
});

test("staff get a draft to approve, and the student hears it's under review", () => {
  assert.match(WAIVER_DRAFT, /approved/);
  assert.match(UNDER_REVIEW, /counselor for review/);
});
