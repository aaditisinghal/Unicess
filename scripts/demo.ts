// Runs the whole demo script on the local server (the same as the dashboard's "Play the demo" button)
// and prints each step as it finishes. Nothing is sent: replayed emails are answered in the log only.
// Usage: npm run demo   (with the server running)
//        npm run demo -- --record   (also saves the run to fixtures/recording.json for recorded mode)
import { env } from "../src/env";

const base = `http://localhost:${env.port}`;
const token = env.dashboardToken;
if (!token) throw new Error("Set DASHBOARD_TOKEN in .env; the demo talks to the server's dashboard API");
const auth = `token=${encodeURIComponent(token)}`;

type Event = { id: number; type: string; text: string; data?: Record<string, unknown> };
type State = { lastId: number; events: Event[]; busy: string | null; mode: string };
const state = async (since: number) => (await fetch(`${base}/api/state?since=${since}&${auth}`)).json() as Promise<State>;

let since = (await state(0)).lastId;
const path = process.argv.includes("--record") ? "/api/record" : "/api/play";
const res = await fetch(`${base}${path}?${auth}`, { method: "POST" });
const started = (await res.json()) as { ok?: boolean; error?: string; mode?: string };
if (!res.ok) throw new Error(started.error ?? `HTTP ${res.status}`);
console.log(`Playing the demo (${started.mode} mode). Watch it on the dashboard.\n`);

const t0 = Date.now();
for (;;) {
  await new Promise((r) => setTimeout(r, 1000));
  const s = await state(since);
  since = s.lastId;
  for (const e of s.events) {
    if (e.type === "scenario" && e.data?.status === "started") console.log(`== ${e.text}`);
    if (e.type === "scenario" && e.data?.status === "failed") throw new Error(e.text);
    if (e.type === "reply") console.log(`   ${e.text}`);
  }
  if (!s.busy && Date.now() - t0 > 2000) break;
}
console.log(`\nDemo finished in ${((Date.now() - t0) / 1000).toFixed(0)} s.`);
