// Answers staff taught an office: when an agent hit a gap in its knowledge file and a counselor
// supplied the answer, that answer is kept in Primitive Memories (knowledge/<agent>) and added to
// the agent's prompt, so the next student with the same question is answered with no human.
// Only factual gaps are learned. Money decisions (waivers, exceptions) always go to a human.
import type { Agent } from "./cases";
import { readMemory, updateMemory } from "./memory";

export type LearnedFact = { question: string; answer: string; from: string; at: string };

const key = (agent: Agent) => `knowledge/${agent}`;
const cache = new Map<Agent, { at: number; facts: LearnedFact[] }>();

export async function getLearned(agent: Agent): Promise<LearnedFact[]> {
  const hit = cache.get(agent);
  if (hit && Date.now() - hit.at < 5_000) return hit.facts;
  const stored = await readMemory<LearnedFact[]>(key(agent)).catch(() => null);
  const facts = stored?.value ?? [];
  cache.set(agent, { at: Date.now(), facts });
  return facts;
}

export async function addLearned(agent: Agent, fact: LearnedFact): Promise<void> {
  const facts = await updateMemory<LearnedFact[]>(key(agent), () => [], (current) => [...current.slice(-19), fact]);
  cache.set(agent, { at: Date.now(), facts });
}

export function learnedSection(facts: LearnedFact[]): string {
  if (!facts.length) return "";
  return `\n\n## Answers learned from staff (treat these as part of your knowledge file)\n${facts
    .map((f) => `- Question: ${f.question}\n  Answer: ${f.answer}`)
    .join("\n")}`;
}
