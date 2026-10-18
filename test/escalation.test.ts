import assert from "node:assert/strict";
import { test } from "node:test";
import { newText } from "../src/escalation";

test("APPROVE is found above the quoted email", () => {
  assert.equal(newText("APPROVE\n\nOn Sat, Oct 18, 2026 at 5:00 AM Halden <finaid@x> wrote:\n> --- Draft ---\n> Your waiver is approved"), "APPROVE");
});

test("a counselor's edit keeps every line they wrote, and nothing quoted", () => {
  const body = "Yes, we can waive it.\nPlease reply with your ID.\n\n> On Sat someone wrote:\n> the draft";
  assert.equal(newText(body), "Yes, we can waive it.\nPlease reply with your ID.");
});

test("the agent's own draft markers never leak into the answer", () => {
  assert.equal(newText("Approved with changes.\n--- Draft ---\nold text"), "Approved with changes.");
  assert.equal(newText("-----Original Message-----\nquoted"), "");
});
