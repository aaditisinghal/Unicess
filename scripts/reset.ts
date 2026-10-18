// Shows or deletes one student's case file and the task and escalation keys created from their emails.
// Run it before every rehearsal so old facts and the outbound-email cap don't carry over.
// Usage: npm run reset -- student@example.com [--show]
import { parseArgs } from "node:util";
import { type CaseFile, caseKey } from "../src/cases";
import { deleteMemoryKey, listMemoryKeys, readMemory } from "../src/memory";

const { values, positionals } = parseArgs({ options: { show: { type: "boolean", default: false } }, allowPositionals: true });
const student = positionals[0]?.toLowerCase();
if (!student) throw new Error("Usage: npm run reset -- student@example.com [--show]");

const stored = await readMemory<CaseFile>(caseKey(student));
if (!stored) {
  console.log(`No case file for ${student}`);
} else {
  const keys = [caseKey(student)];
  for (const email of stored.value.emails) {
    keys.push(...(await listMemoryKeys(`task/${email.id}/`)), ...(await listMemoryKeys(`escalation/${email.id}`)));
  }

  if (values.show) {
    console.log(JSON.stringify(stored.value, null, 2));
    for (const key of keys.slice(1)) console.log(key, JSON.stringify((await readMemory(key))?.value));
  } else {
    await Promise.all(keys.map(deleteMemoryKey));
    console.log(`Deleted ${keys.length} keys for ${student}:\n  ${keys.join("\n  ")}`);
  }
}
