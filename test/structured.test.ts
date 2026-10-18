import assert from "node:assert/strict";
import { test } from "node:test";
import { wantsStructuredReply } from "../src/structured";
import { parseJson } from "../src/student-agent";

test("an AI agent can ask for a structured reply in several ways", () => {
  for (const body of ["Reply format: structured", "reply format:json", "Please send a structured reply", "Respond in JSON please"]) {
    assert.ok(wantsStructuredReply(null, body), body);
  }
  assert.ok(wantsStructuredReply("Reply format: structured", ""));
});

test("ordinary emails don't get a JSON block", () => {
  for (const body of ["What's the deadline?", "My JSON skills are good", "I structured my essay"]) {
    assert.equal(wantsStructuredReply("Question", body), false, body);
  }
});

test("the student's agent reads the JSON block out of a reply", () => {
  const reply = 'Next step: send it\n\n```json\n{"missing_items":[{"item":"transcript","label":"Official transcript","due":"2027-01-15","required":"yes"}]}\n```';
  assert.equal(parseJson(reply)?.missing_items?.[0]?.item, "transcript");
});

test("no block, or a broken one, gives null instead of throwing", () => {
  assert.equal(parseJson("plain text"), null);
  assert.equal(parseJson("```json\n{broken\n```"), null);
});
