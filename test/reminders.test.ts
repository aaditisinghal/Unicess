import assert from "node:assert/strict";
import { test } from "node:test";
import type { ChecklistItem } from "../src/cases";
import { dueSoon } from "../src/reminders";

const item = (item: string, deadline: string, status: ChecklistItem["status"] = "missing"): ChecklistItem => ({ item, label: item, deadline, status });
const list = [
  item("english_test", "January 15, 2027"),
  item("transcript", "January 15, 2027"),
  item("funding_proof", "June 1, 2027"),
  item("sponsor_letter", "June 1, 2027", "if_parent"),
  item("old", "January 1, 2027", "received"),
];

test("on January 5 the January 15 items are 10 calendar days away", () => {
  const due = dueSoon(list, new Date("2027-01-05T09:00:00"));
  assert.deepEqual(due.map((i) => [i.item, i.daysLeft]), [["english_test", 10], ["transcript", 10]]);
});

test("items far in the future, received or conditional are left out", () => {
  const due = dueSoon(list, new Date("2026-10-18T09:00:00"));
  assert.equal(due.length, 0);
});

test("overdue items are included, most overdue first", () => {
  const due = dueSoon([item("a", "January 15, 2027"), item("b", "January 10, 2027")], new Date("2027-01-20T09:00:00"));
  assert.deepEqual(due.map((i) => [i.item, i.daysLeft]), [["b", -10], ["a", -5]]);
});

test("the time of day doesn't change the count", () => {
  assert.equal(dueSoon(list, new Date("2027-01-05T23:59:00"))[0]!.daysLeft, 10);
  assert.equal(dueSoon(list, new Date("2027-01-05T00:01:00"))[0]!.daysLeft, 10);
});
