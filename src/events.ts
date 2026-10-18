// In-process event log and case snapshots for the dashboard. Polling it costs no Memories reads.
// It resets when the server restarts; the durable state stays in Primitive Memories.
import type { CaseFile } from "./cases";

export type DeskEvent = {
  id: number;
  at: string;
  type:
    | "inbound"
    | "route"
    | "document"
    | "post"
    | "reply"
    | "checklist"
    | "counselor"
    | "escalation"
    | "approval"
    | "model_fallback"
    | "skip";
  student?: string;
  agent?: string;
  text: string;
  data?: Record<string, unknown>;
};

const MAX_EVENTS = 1000;
const events: DeskEvent[] = [];
let nextId = 1;
const cases = new Map<string, CaseFile>();
let domain: string | null = null;

export function emit(type: DeskEvent["type"], text: string, fields: Omit<DeskEvent, "id" | "at" | "type" | "text"> = {}) {
  events.push({ id: nextId++, at: new Date().toISOString(), type, text, ...fields });
  if (events.length > MAX_EVENTS) events.shift();
}

export function rememberCase(caseFile: CaseFile) {
  cases.set(caseFile.student, caseFile);
}

export function setDomain(value: string) {
  domain ??= value;
}

export function snapshot(sinceId: number) {
  const replies = events.filter((e) => e.type === "reply" && typeof e.data?.ms === "number");
  const times = replies.map((e) => e.data!.ms as number).sort((a, b) => a - b);
  const allCases = [...cases.values()];
  return {
    domain,
    lastId: nextId - 1,
    events: events.filter((e) => e.id > sinceId),
    cases: allCases,
    metrics: {
      lastReplyMs: replies.at(-1)?.data?.ms ?? null,
      medianReplyMs: times.length ? times[Math.floor(times.length / 2)] : null,
      replies: replies.length,
      repliesWithoutHuman: replies.filter((e) => !e.data?.escalated).length,
      handoffs: events.filter((e) => e.type === "route").reduce((n, e) => n + ((e.data?.agents as string[] | undefined)?.length ?? 0), 0),
      itemsCleared: allCases.reduce((n, c) => n + c.checklist.filter((i) => i.status === "received").length, 0),
    },
  };
}
