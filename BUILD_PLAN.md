# Unicess build plan

What gets built, in what order, who does it, and how we know each step works. The design lives in the [University Inbox Agents design doc](https://claude.ai/artifact/CLxuXNDiZfL9oYYu9JutvX); this file is the execution order. Retimed from a 9:00 PM start (Oct 17, 2026). Feature freeze stays at 4:00 AM, and submission is due by 10:00 AM.

## How we stay fast

- Every step ends with a check that takes under a minute. The next step starts only once it passes.
- Test locally first: `scripts/replay.ts` posts a signed fake webhook to localhost, and `DRY_RUN=1` logs replies instead of sending them. Use real email only for each step's final check, because recipient gates stay on even after the account is claimed.
- Claude writes the code. You handle the dashboard clicks, keys, PDFs and phone tests in parallel (the "You" column).
- One commit per step. If a step overruns by 20 minutes, cut from the top of the design doc's cut list: `housing@`, dashboard polish, human escalation, JSON block.

## Setup (you, during step 1)

1. Claim the Primitive account with your email. Until then, sends are capped at 10 an hour and 50 a day.
2. Copy `.env.example` to `.env` and fill it in. Paste the webhook signing secret exactly as shown; don't base64-decode it. Keys go only in `.env`, never in chat or git.
3. Start a public URL for the local server: `npm run dev`, then `ngrok http 3000` in a second terminal. Railway replaces ngrok for the demo (step 2).
4. In Primitive, under **Webhook Endpoints → Add Webhook Endpoint**:
   - **Webhook URL:** `https://<ngrok or Railway host>/webhooks/email`
   - **Enabled:** on
   - **Events:** only `email.received`. Leave bounce, TLS and DMARC reports and every `sent_email.*` event off.
   - **Domain Scope:** leave it; it needs the Power plan, and we don't need it.
   - **Storage Behavior:** keep "Discard content after webhook confirmed" **off**. Agents read attachments and past emails from Primitive's store after the webhook returns.
   - Update the URL whenever the host changes (ngrok restarts change it; Railway doesn't).

## Layout

```
src/
  server.ts        Hono app: POST /webhooks/email, GET /health, later /api/events and the dashboard
  env.ts           loads and checks environment variables
  inbound.ts       verified email in: dedupe, loop guard, staff check, route by recipient
  memory.ts        Primitive Memories: get, compare-and-set with retry, seen/ dedupe        (step 2)
  cases.ts         case file shape, match or open by sender, checklist helpers           (step 2)
  router.ts        ask@: split an email into department tasks (Haiku, keyword fallback) (step 2)
  agents.ts        one runner for every department: role + knowledge + case file (Sonnet) (step 3)
  answer.ts        run departments in parallel, 30 s cut, merge in fixed order, save facts (step 3)
  knowledge/*.md   ask, intl, admissions, finaid, housing, counselor                    (step 3)
  attachments.ts   download the tar.gz, unpack, PDF to Claude, fields into facts        (step 4)
  checklist.ts     checklist computed from documents and facts, no model call           (step 5)
  counselor.ts     counselor@'s missing-items email after ask@'s first reply             (step 5)
  escalation.ts    draft to staff, APPROVE handling                                     (step 5)
  structured.ts    JSON block + .json attachment when an email asks for a structured reply (step 6)
  events.ts        in-process event log the dashboard polls                             (step 7)
public/dashboard.html                                                                   (step 7)
scripts/
  replay.ts        sign a fake inbound email and POST it to localhost                   (step 2)
  reset.ts         delete a student's case/, task/ and escalation/ keys                 (step 2)
  demo.ts          replay the whole demo script in order against the local server       (step 7)
fixtures/          synthetic bank statement and TOEFL PDFs                              (step 2, you)
```

## Steps

| # | Time | Claude builds | You, in parallel | Done when |
| --- | --- | --- | --- | --- |
| 1 | 9:00-10:00 PM | Hono server; `POST /webhooks/email` verified with `primitive.receive()`, returns 200 at once; echo reply from the addressed agent with an idempotency key; `/health` | Setup above. Time one email between two of your own Primitive addresses (handoff decision). Run `npx primitive@latest chat --help` | An email from your phone to `ask@` gets an echo reply in the same thread |
| 2 | 10:00-11:00 PM | Memories wrapper and `seen/` dedupe; case match by sender; staff-reply check; router classifies topics (Haiku, structured output) and writes task keys; `replay.ts`, `reset.ts` | Deploy to Railway and point the webhook at it. Make the synthetic PDFs: bank statement (Sept 2026, father's name, $31,000) and TOEFL score | One replayed email creates a case and three task keys; `reset` clears them |
| 3 | 11:00 PM-12:45 AM | Knowledge files; agent runner (Sonnet); parallel runs with a 30 s cut; fixed-order merge under a Haiku next-step line; combined reply | Proofread the knowledge files against the design doc's figures | Demo step 5: one combined reply, each section signed |
| 4 | 12:45-1:30 AM | Attachments: download, unpack, PDF to Sonnet, fields into `facts`, shortfall in intl@'s section | Send the bank-statement email from your phone | Demo step 4: balance, $15,400 shortfall, holder not the student |
| 5 | 1:30-2:45 AM | counselor@ checklist and missing-items email after the reply; mark received; ask-back resume; escalation draft to staff; APPROVE path | Have the counselor address email `ask@` once. Create the second Primitive inbox for the AI agent | Demo steps 6 and 8 work from the phone |
| 6 | 2:45-3:15 AM | Structured JSON block for agent senders | Run `primitive chat` from the second inbox to `intl@` | Demo step 9: the JSON parses |
| 7 | 3:15-4:00 AM | Dashboard: event feed, internal thread, time to first reply | Dry-run the script once | Dashboard updates live during a replay |

After step 7: feature freeze at 4:00 AM. Sleep 4:00-7:00. Rehearse 7:00-8:30, resetting the case before each run, and record the backup video. Write the README and submit 8:30-9:45.

**Spam:** Gmail files replies from `cool-jay.primitive.email` as spam (seen in step 1, even though delivery and DKIM passed). On every inbox used in the demo, mark the first reply "Not spam" and add the agent addresses to contacts before going on stage. Tell judges who email `ask@` to check Spam. A verified custom domain might help, but only if there's time after step 7.

## Claude API choices (steps 2-6)

- Models, per the design doc: `claude-haiku-5-5` for routing and field extraction, `claude-sonnet-5-5` for answers and reading PDFs. Set `output_config.effort` explicitly on each call.
- Classification and extraction use structured outputs (`output_config.format`), not forced tool calls: Sonnet 5.5 rejects `tool_choice` `any`/`tool`.
- PDFs go in as base64 `document` blocks, placed before the text block.
- Sonnet 5.5 calls send the server-side refusal fallback (`fallbacks: "default"`), so a safety-classifier false positive on a bank statement doesn't stall a reply.
- Email and attachment text goes into the user turn as data, never into the system prompt.
