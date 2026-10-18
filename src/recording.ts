// Recorded mode: when the Primitive or model keys don't work (rotated, rate-limited, offline), the
// dashboard replays a real recorded run with its original timing, so a judge still sees the whole story.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import type { CaseFile } from "./cases";
import { type RecordedItem, emit, rememberCase, setDomain, startRecording, stopRecording } from "./events";
import { DEMO_DOMAIN } from "./webhook-payload";

const FILE = new URL("../fixtures/recording.json", import.meta.url);

export const hasRecording = () => existsSync(FILE);

let playing = false;
export const isPlayingRecording = () => playing;

export async function playRecording(speed = 1): Promise<void> {
  if (playing) throw new Error("The recorded run is already playing");
  const items = JSON.parse(readFileSync(FILE, "utf8")) as RecordedItem[];
  // Fresh addresses per playback, so a second play doesn't merge into the first one's cards.
  const tag = Math.random().toString(36).slice(2, 7);
  const rename = (s: string | undefined) => s?.replace(/\+[a-z0-9]+@/, `+${tag}@`);
  playing = true;
  setDomain(DEMO_DOMAIN);
  try {
    const start = Date.now();
    for (const item of items) {
      const wait = item.t / speed - (Date.now() - start);
      if (wait > 0) await new Promise((r) => setTimeout(r, wait));
      if (item.event) {
        const { type, text, at: _, student, ...rest } = item.event;
        emit(type, text, { ...rest, student: rename(student), data: { ...rest.data, recorded: true } });
      }
      if (item.case) rememberCase({ ...(item.case as CaseFile), student: rename(item.case.student)! });
    }
  } finally {
    playing = false;
  }
}

// Wraps a live run and saves everything it produced as the recording.
export async function recordRun(run: () => Promise<unknown>): Promise<number> {
  startRecording();
  try {
    await run();
  } finally {
    const items = stopRecording();
    if (items.length) writeFileSync(FILE, JSON.stringify(items));
  }
  return JSON.parse(readFileSync(FILE, "utf8")).length;
}
