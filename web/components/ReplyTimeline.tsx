"use client";
import { useRef } from "react";
import { MOTION_OFF, MOTION_OK, gsap, useGSAP } from "@/lib/gsap";

// One applicant email, replayed: each step lights at the second it happened, and the clock stops at the reply.
const STEPS: { t: number; who: string; color: string; what: React.ReactNode }[] = [
  { t: 0.4, who: "ask@", color: "var(--ink2)", what: "Read the email and the bank statement" },
  { t: 1.2, who: "ask@", color: "var(--ink2)", what: <>Routed to <b className="font-semibold text-ink">three offices</b> at once</> },
  { t: 4.8, who: "intl@", color: "var(--intl)", what: <>Funding gap is <b className="font-semibold text-ink">$15,400</b>; a sponsor letter is needed</> },
  { t: 5.1, who: "housing@", color: "var(--housing)", what: "Housing deposit and deadline" },
  { t: 5.6, who: "finaid@", color: "var(--finaid)", what: <>Up to <b className="font-semibold text-ink">$8,000</b> in merit scholarship</> },
  { t: 6.7, who: "reply", color: "var(--accent)", what: <><b className="font-semibold text-ink">One email</b>, in the applicant&apos;s thread</> },
];
const END = 6.7;

export function ReplyTimeline() {
  const ref = useRef<HTMLDivElement>(null);
  const clock = useRef<HTMLSpanElement>(null);
  const state = useRef<HTMLSpanElement>(null);

  useGSAP(
    () => {
      const rows = gsap.utils.toArray<HTMLElement>("[data-step]");
      const setDone = (done: boolean) => {
        ref.current?.toggleAttribute("data-done", done);
        if (state.current) state.current.textContent = done ? "REPLIED" : "ANSWERING";
      };
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const time = { s: 0 };
        const tl = gsap.timeline({ repeat: -1, repeatDelay: 3, delay: 0.6, onRepeat: () => setDone(false) });
        tl.set(rows, { opacity: 0.16, x: -6 }).set(".bar", { scaleX: 0 }).call(() => setDone(false));
        tl.to(time, {
          s: END,
          duration: END,
          ease: "none",
          onUpdate: () => {
            if (clock.current) clock.current.textContent = time.s.toFixed(1);
          },
        }, 0);
        tl.to(".bar", { scaleX: 1, duration: END, ease: "none" }, 0);
        rows.forEach((row) => tl.to(row, { opacity: 1, x: 0, duration: 0.35, ease: "power2.out" }, Number(row.dataset.t)));
        tl.call(() => setDone(true), [], END);
        tl.fromTo(".race-us", { scale: 1 }, { scale: 1.04, duration: 0.18, yoyo: true, repeat: 1, ease: "power1.inOut" }, END);
      });
      mm.add(MOTION_OFF, () => {
        gsap.set(rows, { opacity: 1 });
        if (clock.current) clock.current.textContent = END.toFixed(1);
        setDone(true);
      });
    },
    { scope: ref },
  );

  return (
    <div ref={ref} className="group border border-rule bg-panel" aria-label="An applicant's email, answered by three offices in 6.7 seconds">
      <div className="flex items-center justify-between border-b border-rule px-[18px] py-3.5 font-mono text-[11.5px] tracking-[0.04em] text-muted">
        <span>ask@ · inbound</span>
        <span className="inline-flex items-center gap-[7px] font-semibold tracking-[0.1em] text-signal group-data-done:text-accent">
          <i className="blink h-[7px] w-[7px] bg-current group-data-done:[animation:none]" />
          <span ref={state}>ANSWERING</span>
        </span>
      </div>
      <div className="relative h-0.5 bg-rule">
        <div className="bar absolute inset-0 origin-left bg-signal group-data-done:bg-accent" />
      </div>
      <div className="border-b border-rule px-[18px] py-4">
        <div className="font-mono text-xs text-muted">priya.sharma@example.com</div>
        <div className="mt-1 text-[17px] font-semibold tracking-[-0.015em]">I-20 funding and housing</div>
        <span className="mt-2 inline-block border border-rule-strong px-[7px] font-mono text-[11px] leading-[1.6] text-ink2">bank-statement.pdf</span>
      </div>
      <ol className="m-0 list-none px-[18px] pt-1.5 pb-2.5">
        {STEPS.map((s) => (
          <li
            key={s.t}
            data-step
            data-t={s.t}
            className="grid grid-cols-[58px_104px_minmax(0,1fr)] items-baseline gap-2.5 border-b border-dotted border-rule py-2 text-sm last:border-b-0 max-sm:grid-cols-[48px_minmax(0,1fr)]"
          >
            <span className="font-mono text-[11.5px] text-faint">{s.t.toFixed(1).padStart(4, "0")} s</span>
            <span className="font-mono text-xs font-semibold max-sm:col-start-2" style={{ color: s.color }}>{s.who}</span>
            <span className="text-ink2 max-sm:col-start-2">{s.what}</span>
          </li>
        ))}
      </ol>
      <div className="grid grid-cols-2 border-t border-rule">
        <div className="px-[18px] pt-4 pb-[18px]">
          <div className="font-mono text-[10.5px] tracking-[0.1em] text-muted uppercase">Unicess</div>
          <div className="race-us mt-2.5 origin-left font-mono text-[40px] leading-[1.1] font-semibold tracking-[-0.04em] text-signal group-data-done:text-accent">
            <span ref={clock}>0.0</span>
            <small className="ml-1 text-base font-medium tracking-normal text-muted">s</small>
          </div>
        </div>
        <div className="border-l border-rule px-[18px] pt-4 pb-[18px]">
          <div className="font-mono text-[10.5px] tracking-[0.1em] text-muted uppercase">Typical office reply</div>
          <div className="mt-2.5 font-mono text-[40px] leading-[1.1] font-semibold tracking-[-0.04em] text-faint">
            <s className="decoration-2">7</s>
            <small className="ml-1 text-base font-medium tracking-normal text-muted">days</small>
          </div>
        </div>
      </div>
    </div>
  );
}
