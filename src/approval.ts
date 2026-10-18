// Requests only a human may grant. A fee waiver is a money decision, so it always goes to staff:
// this can't depend on the model remembering to set needs_human (in testing, gemini-2.5-flash-lite
// told the student "forwarded to a counselor" but didn't flag it, and nothing reached staff).
import type { Agent } from "./cases";

const WAIVER = /\b(waive[ds]?|waiver|fee exemption|fee reduction)\b/i;

export const requiresApproval = (agent: Agent, text: string) => agent === "finaid" && WAIVER.test(text);

// What staff approve when the model didn't write a draft.
export const WAIVER_DRAFT =
  "Good news: your request to waive the $75 application fee has been approved. You won't need to pay the fee when you submit your application.";

// What the student hears while staff decide.
export const UNDER_REVIEW =
  "Your fee waiver request has been passed to a counselor for review. You'll get the decision by email; nothing to pay or send in the meantime.";
