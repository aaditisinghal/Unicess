// The application checklist, computed from the case file alone: documents received and facts stated.
// No model call, so it's instant and the same answer every time.
import { type CaseFile, type ChecklistItem, caseKey } from "./cases";
import { updateMemory } from "./memory";

const ITEMS = [
  { item: "english_test", label: "English test score (TOEFL 80, IELTS 6.5 or Duolingo 110)", deadline: "January 15, 2027", kind: "english_test" },
  { item: "transcript", label: "Official transcript", deadline: "January 15, 2027", kind: "transcript" },
  { item: "funding_proof", label: "Funding proof: a bank statement less than 6 months old", deadline: "June 1, 2027", kind: "bank_statement" },
  { item: "sponsor_letter", label: "Signed sponsor letter from the account holder", deadline: "June 1, 2027", kind: "sponsor_letter" },
] as const;

const PARENT = /\b(father|mother|parent|dad|mom|guardian|sponsor)/i;
const SELF = /\b(student|self|my own|own account|myself)\b/i;

export function computeChecklist(c: CaseFile): ChecklistItem[] {
  const docs = c.documents ?? [];
  return ITEMS.map(({ item, label, deadline, kind }) => {
    const doc = docs.find((d) => d.kind === kind);
    if (doc) return { item, label, deadline, status: "received", sourceEmailId: doc.emailId };
    if (item !== "sponsor_letter") return { item, label, deadline, status: "missing" };
    return { item, label, deadline, status: sponsorLetterStatus(c) };
  });
}

// A sponsor letter is needed only when the funding account is a parent's.
function sponsorLetterStatus(c: CaseFile): ChecklistItem["status"] {
  const relationship = c.facts.account_relationship;
  if (relationship === "parent" || relationship === "other") return "missing";
  if (relationship === "student") return "not_needed";
  const holder = String(c.facts.account_holder ?? "");
  if (PARENT.test(holder)) return "missing";
  if (SELF.test(holder)) return "not_needed";
  const holderName = String(c.facts.funds_account_holder_name ?? "").toLowerCase().trim();
  const studentName = String(c.facts.student_name ?? "").toLowerCase().trim();
  if (holderName && studentName && holderName === studentName) return "not_needed";
  return "if_parent";
}

export async function refreshChecklist(student: string): Promise<CaseFile> {
  return updateMemory<CaseFile>(
    caseKey(student),
    () => {
      throw new Error(`case file for ${student} disappeared`);
    },
    (current) => ({ ...current, checklist: computeChecklist(current), updatedAt: new Date().toISOString() }),
  );
}

export const openItems = (checklist: ChecklistItem[]) =>
  checklist.filter((i) => i.status === "missing" || i.status === "if_parent");
