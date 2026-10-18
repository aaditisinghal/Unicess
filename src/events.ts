// In-process event log and case snapshots for the dashboard. Polling it costs no Memories reads.
// It resets when the server restarts; the durable state stays in Primitive Memories.
import type { CaseFile } from "./cases";

export type DeskEvent = {
  id: number;
  at: string;
  type:
    | "inbound"
    | "route"
    | "handoff"
    | "document"
    | "post"
    | "reply"
    | "followup"
    | "reminder"
    | "checklist"
    | "counselor"
    | "ask_back"
    | "resume"
    | "escalation"
    | "approval"
    | "learned"
    | "shield"
    | "agent_step"
    | "model_fallback"
    | "skip"
    | "scenario";
  student?: string;
  agent?: string;
  text: string;
  data?: Record<string, unknown>;
  // The Primitive calls that made this happen, shown by the dashboard's "under the hood" toggle.
  primitive?: string[];
};

// One entry in a recording: an event or a case snapshot, with its offset from the start of the run.
export type RecordedItem = { t: number; event?: Omit<DeskEvent, "id">; case?: CaseFile };

const MAX_EVENTS = 1500;
const events: DeskEvent[] = [];
let nextId = 1;
const cases = new Map<string, CaseFile>();
let domain: string | null = null;
const listeners = new Set<(e: DeskEvent) => void>();

// Recording: every event and case snapshot from start() until stop(), for the offline fallback.
let recording: { startedAt: number; items: RecordedItem[] } | null = null;

export function emit(
  type: DeskEvent["type"],
  text: string,
  fields: Omit<DeskEvent, "id" | "at" | "type" | "text"> = {},
): DeskEvent {
  const event: DeskEvent = { id: nextId++, at: new Date().toISOString(), type, text, ...fields };
  events.push(event);
  if (events.length > MAX_EVENTS) events.shift();
  if (recording) {
    const { id: _, ...rest } = event;
    recording.items.push({ t: Date.now() - recording.startedAt, event: rest });
  }
  for (const listener of listeners) listener(event);
  return event;
}

export function rememberCase(caseFile: CaseFile) {
  cases.set(caseFile.student, caseFile);
  if (recording) recording.items.push({ t: Date.now() - recording.startedAt, case: structuredClone(caseFile) });
}

export function onEvent(listener: (e: DeskEvent) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Resolves with the first event (from now on) that matches, or rejects after the timeout.
export function waitForEvent(match: (e: DeskEvent) => boolean, timeoutMs = 90_000): Promise<DeskEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      off();
      reject(new Error("timed out waiting for the agents"));
    }, timeoutMs);
    const off = onEvent((e) => {
      if (!match(e)) return;
      clearTimeout(timer);
      off();
      resolve(e);
    });
  });
}

export function startRecording() {
  recording = { startedAt: Date.now(), items: [] };
}

export function stopRecording(): RecordedItem[] {
  const items = recording?.items ?? [];
  recording = null;
  return items;
}

export function setDomain(value: string) {
  domain ??= value;
}

export function getDomain() {
  return domain;
}

export function snapshot<T extends Record<string, unknown>>(sinceId: number, extra: T = {} as T) {
  const replies = events.filter((e) => e.type === "reply" && typeof e.data?.ms === "number");
  const times = replies.map((e) => e.data!.ms as number).sort((a, b) => a - b);
  const allCases = [...cases.values()];
  // Replies sent outside 9 AM to 5 PM on weekdays, when a real office would be closed.
  const afterHours = replies.filter((e) => {
    const d = new Date(e.at);
    return d.getDay() === 0 || d.getDay() === 6 || d.getHours() < 9 || d.getHours() >= 17;
  }).length;
  return {
    domain,
    lastId: nextId - 1,
    events: events.filter((e) => e.id > sinceId),
    cases: allCases,
    ...extra,
    metrics: {
      lastReplyMs: replies.at(-1)?.data?.ms ?? null,
      medianReplyMs: times.length ? times[Math.floor(times.length / 2)] : null,
      replies: replies.length,
      repliesWithoutHuman: replies.filter((e) => !e.data?.escalated).length,
      handoffs: events.filter((e) => e.type === "route").reduce((n, e) => n + ((e.data?.agents as string[] | undefined)?.length ?? 0), 0),
      itemsCleared: allCases.reduce((n, c) => n + c.checklist.filter((i) => i.status === "received").length, 0),
      afterHours,
      // A staff member spends about 12 minutes researching and writing a multi-office reply.
      staffMinutesSaved: replies.length * 12,
      shields: events.filter((e) => e.type === "shield").length,
    },
  };
}
