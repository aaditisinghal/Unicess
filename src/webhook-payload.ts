// Builds a signed email.received webhook, the same shape Primitive delivers, for replayed and
// in-dashboard scenarios. Ids start with "replay_", so the server never sends real mail for them.
import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { signWebhookPayload } from "@primitivedotdev/sdk/webhook";

export const DEMO_DOMAIN = "cool-jay.primitive.email";

export type ReplayEmail = {
  to: string; // local part (ask) or full address
  from: string;
  subject: string;
  body: string;
  attach?: string[]; // files in fixtures/
  inReplyTo?: string | null; // Message-ID this email replies to
  references?: string[];
  headers?: Record<string, string>; // extra raw headers, e.g. Auto-Submitted
  authenticated?: boolean; // false simulates a spoofed sender (SPF/DKIM/DMARC fail)
  domain?: string;
};

export function buildReplayEvent(input: ReplayEmail) {
  const domain = input.domain ?? DEMO_DOMAIN;
  const to = input.to.includes("@") ? input.to : `${input.to}@${domain}`;
  const id = randomUUID();
  const now = new Date();
  const messageId = `<${id}@replay.local>`;
  const body = input.body.replaceAll("\\n", "\n");

  const attachments = (input.attach ?? []).map((filename, i) => {
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

  // A minimal RFC 822 message, so code that reads raw headers (Auto-Submitted) sees real ones.
  const rawHeaders = [
    `Message-ID: ${messageId}`,
    `From: ${input.from}`,
    `To: ${to}`,
    `Subject: ${input.subject}`,
    `Date: ${now.toUTCString()}`,
    ...(input.inReplyTo ? [`In-Reply-To: ${input.inReplyTo}`] : []),
    ...(input.references?.length ? [`References: ${input.references.join(" ")}`] : []),
    ...Object.entries(input.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
  ];
  const raw = Buffer.from(`${rawHeaders.join("\r\n")}\r\n\r\n${body}`);

  const authenticated = input.authenticated !== false;
  const senderDomain = input.from.split("@")[1] ?? "example.com";
  const event = JSON.parse(readFileSync(new URL("../fixtures/email-received.template.json", import.meta.url), "utf8"));
  event.id = `evt_${randomBytes(32).toString("hex")}`;
  event.delivery.attempted_at = now.toISOString();
  event.email = {
    ...event.email,
    id: `replay_${id}`,
    thread_id: randomUUID(),
    received_at: now.toISOString(),
    smtp: { ...event.email.smtp, mail_from: input.from, rcpt_to: [to] },
    headers: { message_id: messageId, subject: input.subject, from: input.from, to, date: now.toUTCString() },
    content: {
      ...event.email.content,
      raw: {
        ...event.email.content.raw,
        size_bytes: raw.length,
        sha256: createHash("sha256").update(raw).digest("hex"),
        data: raw.toString("base64"),
      },
    },
    parsed: {
      ...event.email.parsed,
      body_text: body,
      body_html: null,
      to_addresses: [{ address: to, name: null }],
      // Primitive delivers In-Reply-To as a list of message ids.
      in_reply_to: input.inReplyTo ? [input.inReplyTo] : null,
      references: input.references?.length ? input.references : null,
      attachments,
      // Replayed attachments are read from fixtures/, so this URL is never fetched.
      attachments_download_url: attachments.length > 0 ? "https://replay.invalid/attachments.tar.gz" : null,
    },
    auth: authenticated
      ? {
          ...event.email.auth,
          dmarcFromDomain: senderDomain,
          dkimSignatures: event.email.auth.dkimSignatures.map((s: Record<string, unknown>) => ({ ...s, domain: senderDomain })),
        }
      : {
          ...event.email.auth,
          spf: "fail",
          dmarc: "fail",
          dmarcFromDomain: senderDomain,
          dmarcSpfAligned: false,
          dmarcDkimAligned: false,
          dkimSignatures: [],
        },
  };
  return { event, emailId: event.email.id as string, messageId, to };
}

export function signedRequest(event: unknown, secret: string) {
  const body = JSON.stringify(event);
  return {
    body,
    headers: {
      "content-type": "application/json",
      "X-Webhook-Event": "email.received",
      "Primitive-Signature": signWebhookPayload(body, secret).header,
    },
  };
}
