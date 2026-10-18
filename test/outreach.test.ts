import assert from "node:assert/strict";
import { test } from "node:test";
import { maskEmail, outreachMessage, waitBeforeNext } from "../src/outreach";

test("the portal shows the demo inbox partly hidden", () => {
  assert.equal(maskEmail("aaditisinghal14@gmail.com"), "a••••••••@gmail.com");
  assert.equal(maskEmail("jo@halden.edu"), "j•••@halden.edu");
});

test("the button can send at most once every 20 seconds", () => {
  assert.equal(waitBeforeNext(1_000_000, 0), 0);
  assert.equal(waitBeforeNext(1_005_000, 1_000_000), 15_000);
  assert.equal(waitBeforeNext(1_020_000, 1_000_000), 0);
});

test("the email invites a reply and signs from ask@ on the live domain", () => {
  const { subject, text } = outreachMessage("cool-jay.primitive.email");
  assert.match(subject, /reply/i);
  assert.match(text, /Reply to this email/);
  assert.match(text, /ask@cool-jay\.primitive\.email/);
});
