// Agent senders: when an email asks for a structured reply, the human reply also carries a JSON block
// (and a .json attachment) that the student's AI agent can parse without reading prose.
import { z } from "zod";
import { OFFICES } from "./agents";
import type { Agent, CaseFile } from "./cases";
import { generateJson } from "./llm";

// "Reply format: structured", "reply in JSON", "structured reply"...
const TRIGGER = /reply\s+format\s*:\s*(structured|json)|\bstructured\s+(reply|response|answer)\b|\b(reply|respond|answer)\s+in\s+json\b/i;

export const wantsStructuredReply = (subject: string | null, body: string) => TRIGGER.test(`${subject ?? ""}\n${body}`);

// Only what the office sections state; the model fills these, code fills the rest.
const Extracted = z.object({
  deadlines: z.array(
    z.object({
      item: z.string().describe("What is due, e.g. I-20 funding documents"),
      date: z.string().describe("YYYY-MM-DD"),
      office: z.string().describe("Office address that stated it"),
    }),
  ),
  requirements: z.array(z.object({ item: z.string(), detail: z.string(), office: z.string() })),
  amounts: z.array(
    z.object({
      label: z.string().describe("e.g. cost of attendance, funds shown, shortfall, scholarship maximum"),
      usd: z.number(),
      office: z.string(),
    }),
  ),
});

const SYSTEM = `Convert university office replies into JSON fields for a software agent.
Use only facts stated in the replies; never add or infer one. Dates as YYYY-MM-DD.
For "office", use the office address shown in the section heading.`;

const ISO_DATE: Record<string, string> = {
  "January 15, 2027": "2027-01-15",
  "June 1, 2027": "2027-06-01",
};

export async function buildStructuredReply(input: {
  sections: { agent: Agent; section: string | null }[];
  nextStep: string;
  caseFile: CaseFile;
  domain: string;
}) {
  const { sections, nextStep, caseFile, domain } = input;
  const answered = sections.filter((s) => s.section);
  const text = answered.map((s) => `${OFFICES[s.agent]} (${s.agent}@${domain})\n${s.section}`).join("\n\n");

  let extracted: z.infer<typeof Extracted> = { deadlines: [], requirements: [], amounts: [] };
  if (text) {
    try {
      extracted = await generateJson({ tier: "fast", system: SYSTEM, user: text, schema: Extracted, signal: AbortSignal.timeout(15_000) });
    } catch (err) {
      console.warn(`[structured] extraction failed; sending contacts and checklist only: ${err instanceof Error ? err.message : err}`);
    }
  }

  return {
    format: "unicess/v1",
    school: "Halden University (fictional)",
    student: caseFile.student,
    next_step: nextStep.replace(/^Next step:\s*/, ""),
    ...extracted,
    missing_items: caseFile.checklist
      .filter((i) => i.status === "missing" || i.status === "if_parent")
      .map((i) => ({
        item: i.item,
        label: i.label,
        due: ISO_DATE[i.deadline] ?? i.deadline,
        required: i.status === "missing" ? "yes" : "only if the funding account is a parent's",
      })),
    contacts: sections.map((s) => ({ office: OFFICES[s.agent], address: `${s.agent}@${domain}`, answered: !!s.section })),
    generated_at: new Date().toISOString(),
  };
}

export function structuredBlock(json: unknown): string {
  return ["Structured reply for software agents (also attached as unicess-reply.json):", "```json", JSON.stringify(json, null, 2), "```"].join("\n");
}
