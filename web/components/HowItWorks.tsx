"use client";
import { useRef } from "react";
import { MOTION_OFF, MOTION_OK, gsap, useGSAP } from "@/lib/gsap";
import { SectionHead } from "./SectionHead";

const STEPS = [
  { title: "Arrives", body: <><code className="font-mono text-[13px] text-ink">ask@</code> reads the email and any attachments, then routes it to every office it concerns.</> },
  { title: "Answers", body: "Each office agent answers from its own knowledge file and the applicant's record, in parallel." },
  { title: "Replies", body: "One combined reply goes out in the applicant's thread. A slow office follows up in the same thread." },
  { title: "Escalates", body: "Fee waivers, refunds, extensions and exceptions go to staff. Questions an office can't answer do too. Agents never guess." },
];

// On wide screens the section pins while scrolling walks through the four steps; elsewhere they simply fade in.
export function HowItWorks() {
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(`(min-width: 1024px) and ${MOTION_OK}`, () => {
        gsap.set("[data-reveal]", { autoAlpha: 1 });
        const tl = gsap.timeline({ scrollTrigger: { trigger: ".pin", start: "center center+=34", end: "+=1100", scrub: 0.6, pin: true } });
        tl.fromTo(".progress", { scaleX: 0 }, { scaleX: 1, ease: "none", duration: 4 }, 0);
        gsap.utils.toArray<HTMLElement>("[data-step]").forEach((step, i) => {
          tl.fromTo(step, { opacity: 0.22, y: 18 }, { opacity: 1, y: 0, duration: 0.7, ease: "power2.out" }, i * 0.95);
          tl.fromTo(step.querySelector(".num"), { color: "var(--faint)" }, { color: "var(--accent)", duration: 0.3 }, i * 0.95);
        });
      });
      mm.add(`(max-width: 1023px) and ${MOTION_OK}`, () => {
        gsap.fromTo("[data-reveal]", { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.8, stagger: 0.1, ease: "power3.out", scrollTrigger: { trigger: ref.current, start: "top 80%" } });
      });
      mm.add(MOTION_OFF, () => gsap.set("[data-reveal]", { autoAlpha: 1 }));
    },
    { scope: ref },
  );

  return (
    <section ref={ref} id="how" className="border-b border-rule py-26 max-sm:py-18">
      <div className="pin mx-auto max-w-[1240px] px-8 max-sm:px-4">
        <SectionHead
          eyebrow="How it works"
          title="One address for applicants. Six offices behind it."
          lede="Applicants write to one address, or straight to any office. Every agent reads and writes the same applicant file, so no one is asked for the same document twice."
        />
        <div className="relative grid grid-cols-4 border-t-2 border-ink max-lg:grid-cols-2 max-sm:grid-cols-1">
          <div className="progress absolute -top-0.5 left-0 h-0.5 w-full origin-left scale-x-0 bg-accent max-lg:hidden" />
          {STEPS.map((s, i) => (
            <div
              key={s.title}
              data-step
              data-reveal
              className={`pt-6 pr-7 pb-2 ${i > 0 ? "border-l border-rule pl-7" : ""} max-lg:[&:nth-child(4)]:border-l-0 max-lg:[&:nth-child(4)]:pl-0 max-sm:border-l-0! max-sm:pl-0! max-sm:[&+&]:border-t max-sm:[&+&]:border-rule`}
            >
              <div className="num font-mono text-xs font-semibold tracking-[0.06em] text-accent">{String(i + 1).padStart(2, "0")}</div>
              <h3 className="mt-3.5 mb-2 text-[21px] font-semibold tracking-[-0.02em]">{s.title}</h3>
              <p className="m-0 text-[15px] text-ink2">{s.body}</p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
