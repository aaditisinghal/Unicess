// Posts a signed fake inbound email to the local server, so flows can be tested without sending real mail.
// The server logs its reply instead of sending it, because the email id starts with "replay_".
// Usage: npm run replay -- [--to intl] [--from student@example.com] [--subject "..."] [--body "..."]
//                          [--attach bank-statement.pdf] (a file in fixtures/; repeat for more)
import { parseArgs } from "node:util";
import { env } from "../src/env";
import { buildReplayEvent, signedRequest } from "../src/webhook-payload";

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

const { event, emailId, to } = buildReplayEvent({
  to: values.to,
  from: values.from,
  subject: values.subject,
  // A literal \n becomes a newline: npm on Windows runs scripts through cmd.exe, which cuts arguments at real newlines.
  body: values.body,
  attach: values.attach,
});
const { body, headers } = signedRequest(event, env.webhookSecret);
const res = await fetch(`http://localhost:${env.port}/webhooks/email`, { method: "POST", headers, body });
console.log(`${res.status} ${await res.text()}  (${values.from} -> ${to}, email ${emailId})`);
