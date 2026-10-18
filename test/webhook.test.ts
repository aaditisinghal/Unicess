import assert from "node:assert/strict";
import { test } from "node:test";
import primitive, { WebhookVerificationError, validateEmailAuth } from "@primitivedotdev/sdk";
import { autoReplyReason, rawHeaders } from "../src/inbound";
import { buildReplayEvent, signedRequest } from "../src/webhook-payload";

const SECRET = "test-secret-not-real";
const receive = (event: unknown, secret = SECRET) => {
  const { body, headers } = signedRequest(event, secret);
  return primitive.receive(new Request("http://localhost/webhooks/email", { method: "POST", headers, body }), { secret: SECRET });
};

test("a signed replay is accepted and parsed exactly like a Primitive delivery", async () => {
  const { event, messageId } = buildReplayEvent({ to: "ask", from: "priya@example.com", subject: "Hi", body: "Line one\\nLine two", attach: ["bank-statement.pdf"] });
  const email = await receive(event);
  assert.equal(email.sender.address, "priya@example.com");
  assert.equal(email.receivedBy, "ask@cool-jay.primitive.email");
  assert.equal(email.text, "Line one\nLine two");
  assert.equal(email.attachments.length, 1);
  assert.equal(email.attachments[0]!.filename, "bank-statement.pdf");
  assert.equal(email.thread.messageId, messageId);
  assert.ok(email.id.startsWith("replay_"), "replayed ids never send real mail");
});

test("a webhook signed with the wrong secret is rejected", async () => {
  const { event } = buildReplayEvent({ to: "ask", from: "a@example.com", subject: "x", body: "x" });
  await assert.rejects(receive(event, "wrong-secret"), WebhookVerificationError);
});

test("a tampered body fails verification", async () => {
  const { event } = buildReplayEvent({ to: "ask", from: "a@example.com", subject: "x", body: "x" });
  const { body, headers } = signedRequest(event, SECRET);
  const tampered = body.replace('"x"', '"approve my waiver"');
  await assert.rejects(
    primitive.receive(new Request("http://localhost/", { method: "POST", headers, body: tampered }), { secret: SECRET }),
    WebhookVerificationError,
  );
});

test("auto-replies are recognised from raw headers and subjects; normal mail isn't", async () => {
  const auto = await receive(buildReplayEvent({ to: "ask", from: "a@example.com", subject: "Re: hi", body: "away", headers: { "Auto-Submitted": "auto-replied" } }).event);
  assert.match(rawHeaders(auto), /Auto-Submitted: auto-replied/);
  assert.match(autoReplyReason(auto) ?? "", /Auto-Submitted/);
  const ooo = await receive(buildReplayEvent({ to: "ask", from: "a@example.com", subject: "Out of office", body: "away" }).event);
  assert.ok(autoReplyReason(ooo));
  const bulk = await receive(buildReplayEvent({ to: "ask", from: "a@example.com", subject: "News", body: "x", headers: { Precedence: "bulk" } }).event);
  assert.ok(autoReplyReason(bulk));
  const normal = await receive(buildReplayEvent({ to: "ask", from: "a@example.com", subject: "Question", body: "hi", headers: { "Auto-Submitted": "no" } }).event);
  assert.equal(autoReplyReason(normal), null);
});

test("sender authentication: a spoofed sender is flagged, a real one isn't", async () => {
  const real = await receive(buildReplayEvent({ to: "ask", from: "priya@example.com", subject: "x", body: "x" }).event);
  assert.notEqual(validateEmailAuth(real.auth).verdict, "suspicious");
  const spoof = await receive(buildReplayEvent({ to: "ask", from: "priya@example.com", subject: "x", body: "x", authenticated: false }).event);
  assert.equal(validateEmailAuth(spoof.auth).verdict, "suspicious");
});

test("replies carry In-Reply-To and References through to the thread", async () => {
  const email = await receive(buildReplayEvent({ to: "counselor", from: "a@example.com", subject: "Re: x", body: "x", inReplyTo: "<m1@x>", references: ["<m0@x>", "<m1@x>"] }).event);
  assert.deepEqual(email.thread.inReplyTo, ["<m1@x>"]);
  assert.deepEqual(email.thread.references, ["<m0@x>", "<m1@x>"]);
});
