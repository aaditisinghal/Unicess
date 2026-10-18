import assert from "node:assert/strict";
import { test } from "node:test";
import { emit, snapshot, waitForEvent } from "../src/events";
import { learnedSection } from "../src/learned";

test("waitForEvent resolves on the first matching event", async () => {
  const waiting = waitForEvent((e) => e.type === "reply" && e.student === "a@example.com", 1000);
  emit("reply", "other", { student: "b@example.com", data: { ms: 1000 } });
  emit("reply", "mine", { student: "a@example.com", data: { ms: 3000 } });
  assert.equal((await waiting).text, "mine");
});

test("waitForEvent times out instead of hanging", async () => {
  await assert.rejects(waitForEvent(() => false, 50), /timed out/);
});

test("metrics: median reply time, replies without a human, attacks stopped", () => {
  emit("reply", "r3", { student: "c@example.com", data: { ms: 5000, escalated: true } });
  emit("shield", "blocked", { data: { kind: "forged_webhook" } });
  const s = snapshot(0, { mode: "live" });
  assert.equal(s.mode, "live");
  assert.equal(s.metrics.replies, 3);
  assert.equal(s.metrics.medianReplyMs, 3000);
  assert.equal(s.metrics.repliesWithoutHuman, 2);
  assert.equal(s.metrics.shields, 1);
  assert.equal(s.metrics.staffMinutesSaved, 36);
  assert.equal(snapshot(s.lastId).events.length, 0, "since= returns only newer events");
});

test("learned answers are added to an office's prompt, and nothing when there are none", () => {
  assert.equal(learnedSection([]), "");
  const section = learnedSection([{ question: "Can I defer?", answer: "Yes, once.", from: "staff@x", at: "now" }]);
  assert.match(section, /Question: Can I defer\?/);
  assert.match(section, /Answer: Yes, once\./);
});
