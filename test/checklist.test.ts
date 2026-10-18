import assert from "node:assert/strict";
import { test } from "node:test";
import type { CaseFile } from "../src/cases";
import { computeChecklist, openItems } from "../src/checklist";

const now = "2026-10-18T00:00:00Z";
const file = (over: Partial<CaseFile> = {}): CaseFile => ({
  student: "priya@example.com",
  status: "open",
  facts: {},
  checklist: [],
  emails: [],
  createdAt: now,
  updatedAt: now,
  ...over,
});
const doc = (kind: string) => ({
  kind,
  summary: "",
  holder_name: null,
  document_date: null,
  balance: null,
  currency: null,
  test_name: null,
  total_score: null,
  emailId: "e1",
  filename: `${kind}.pdf`,
  receivedAt: now,
}) as never;
const status = (c: CaseFile) => Object.fromEntries(computeChecklist(c).map((i) => [i.item, i.status]));

test("a new file needs everything, and the sponsor letter only if the account is a parent's", () => {
  assert.deepEqual(status(file()), { english_test: "missing", transcript: "missing", funding_proof: "missing", sponsor_letter: "if_parent" });
});

test("a document marks its item received and records which email it came from", () => {
  const items = computeChecklist(file({ documents: [doc("bank_statement"), doc("english_test")] }));
  const funding = items.find((i) => i.item === "funding_proof")!;
  assert.equal(funding.status, "received");
  assert.equal(funding.sourceEmailId, "e1");
  assert.equal(items.find((i) => i.item === "english_test")!.status, "received");
});

test("the sponsor letter follows who owns the account", () => {
  assert.equal(status(file({ facts: { account_relationship: "parent" } })).sponsor_letter, "missing");
  assert.equal(status(file({ facts: { account_relationship: "student" } })).sponsor_letter, "not_needed");
  assert.equal(status(file({ facts: { account_holder: "my father" } })).sponsor_letter, "missing");
  assert.equal(status(file({ facts: { account_holder: "myself" } })).sponsor_letter, "not_needed");
});

test("an account in the student's own name needs no sponsor letter", () => {
  const c = file({ facts: { student_name: "Priya Sharma", funds_account_holder_name: "priya sharma" } });
  assert.equal(status(c).sponsor_letter, "not_needed");
});

test("a different holder name alone never decides it: the counselor asks", () => {
  const c = file({ facts: { student_name: "Priya Sharma", funds_account_holder_name: "Rajesh Kumar Sharma" } });
  assert.equal(status(c).sponsor_letter, "if_parent");
});

test("open items are the missing ones plus the conditional sponsor letter", () => {
  const items = computeChecklist(file({ documents: [doc("bank_statement")], facts: { account_relationship: "student" } }));
  assert.deepEqual(openItems(items).map((i) => i.item), ["english_test", "transcript"]);
});
