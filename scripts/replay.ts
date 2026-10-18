// Posts a signed fake inbound email to the local server, so flows can be tested without sending real mail.
// The server logs its reply instead of sending it, because the email id starts with "replay_".
// Usage: npm run replay -- [--to intl] [--from student@example.com] [--subject "..."] [--body "..."]
//                          [--attach bank-statement.pdf] (a file in fixtures/; repeat for more)
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { parseArgs } from "node:util";
import { signWebhookPayload } from "@primitivedotdev/sdk/webhook";
import { env } from "../src/env";

const DOMAIN = "cool-jay.primitive.email";

const { values } = parseArgs({
  options: {
    to: { type: "string", default: "ask" },
    from: { type: "string", default: "student@example.com" },
    subject: { type: "string", default: "I-20 funding and housing" },
    body: {
      type: "string",
      default:
        "Hi, I'm Priya Sharma, applying for Fall 2027 as an international student from India. " +
        "How much do I need to show for my I-20, and can I get on-campus housing? My bank statement is attached.\n\nPriya",
    },
    attach: { type: "string", multiple: true, default: [] },
  },
});

const attachments = values.attach.map((filename, i) => {
  const bytes = readFileSync(new URL(`../fixtures/${filename}`, import.meta.url));
  const type = filename.endsWith(".pdf") ? "application/pdf" : filename.endsWith(".png") ? "image/png" : "image/jpeg";
  return {
    filename,
    content_type: type,
    size_bytes: bytes.length,
    sha256: createHash("sha256").update(bytes).digest("hex"),
    part_index: i + 1,
    tar_path: `${i + 1}_${filename}`,
  };
});

const to = values.to.includes("@") ? values.to : `${values.to}@${DOMAIN}`;
const from = values.from;
const id = randomUUID();
const now = new Date();

const event = JSON.parse(readFileSync(new URL("../fixtures/email-received.template.json", import.meta.url), "utf8"));
event.id = `evt_${randomBytes(32).toString("hex")}`;
event.delivery.attempted_at = now.toISOString();
event.email = {
  ...event.email,
  id: `replay_${id}`,
  thread_id: randomUUID(),
  received_at: now.toISOString(),
  smtp: { ...event.email.smtp, mail_from: from, rcpt_to: [to] },
  headers: { message_id: `<${id}@replay.local>`, subject: values.subject, from, to, date: now.toUTCString() },
  parsed: {
    ...event.email.parsed,
    // A literal \n becomes a newline: npm on Windows runs scripts through cmd.exe, which cuts arguments at real newlines.
    body_text: values.body.replaceAll("\\n", "\n"),
    body_html: null,
    to_addresses: [{ address: to, name: null }],
    attachments,
    // The server reads replayed attachments from fixtures/, so this URL is never fetched.
    attachments_download_url: attachments.length > 0 ? "https://replay.invalid/attachments.tar.gz" : null,
  },
};

const body = JSON.stringify(event);
const res = await fetch(`http://localhost:${env.port}/webhooks/email`, {
  method: "POST",
  headers: {
    "content-type": "application/json",
    "X-Webhook-Event": "email.received",
    "Primitive-Signature": signWebhookPayload(body, env.webhookSecret).header,
  },
  body,
});
console.log(`${res.status} ${await res.text()}  (${from} -> ${to}, email ${event.email.id})`);
