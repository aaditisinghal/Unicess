import assert from "node:assert/strict";
import { test } from "node:test";
import { routeByKeywords } from "../src/router";

const depts = (text: string) => routeByKeywords(text).map((t) => t.department).sort();

test("one email touching several offices is split across all of them", () => {
  assert.deepEqual(depts("How much do I need to show for my I-20, and can I get on-campus housing?"), ["finaid", "housing", "intl"]);
});

test("fee waivers go to financial aid", () => {
  assert.ok(depts("Can I get a fee waiver?").includes("finaid"));
});

test("an email that fits no office goes to admissions, never nowhere", () => {
  assert.deepEqual(depts("Hello there"), ["admissions"]);
});

test("each task carries the question text, capped", () => {
  const [task] = routeByKeywords("x".repeat(2000));
  assert.equal(task!.question.length, 500);
});
