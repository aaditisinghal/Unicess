"use client";
import { useRef } from "react";
import { APP_URL } from "@/lib/app-url";
import { MOTION_OFF, MOTION_OK, gsap, useGSAP } from "@/lib/gsap";
import { ReplyTimeline } from "./ReplyTimeline";

const LEAD = "Every applicant email, answered in seconds by".split(" ");
const ACCENT = "the right office.".split(" ");

export function Hero() {
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        const tl = gsap.timeline({ defaults: { ease: "power4.out" } });
        tl.fromTo("[data-word]", { yPercent: 110, autoAlpha: 1 }, { yPercent: 0, duration: 1, stagger: 0.045 })
          .fromTo("[data-reveal]", { y: 18, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.8, stagger: 0.08 }, "-=0.55")
          .fromTo(".hero-shot", { y: 40, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 1.1 }, "-=0.9");
        // The product shot drifts up slightly as the hero scrolls away.
        gsap.to(".hero-shot", { yPercent: -6, ease: "none", scrollTrigger: { trigger: ref.current, start: "top top", end: "bottom top", scrub: true } });
      });
      mm.add(MOTION_OFF, () => gsap.set("[data-word], [data-reveal], .hero-shot", { autoAlpha: 1 }));
    },
    { scope: ref },
  );

  const word = (w: string, i: number, accent = false) => (
    <span key={`${w}-${i}`} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
      <span data-word className={`inline-block ${accent ? "text-accent" : ""}`}>{w}&nbsp;</span>
    </span>
  );

  return (
    <header ref={ref} className="pt-22 max-sm:pt-14 max-lg:pb-14">
      <div className="mx-auto grid max-w-[1240px] grid-cols-[minmax(0,1.05fr)_minmax(0,0.95fr)] items-end gap-16 px-8 max-lg:grid-cols-1 max-lg:gap-10 max-sm:px-4">
        <div>
          <div data-reveal className="font-mono text-xs tracking-[0.1em] text-muted uppercase">
            <b className="font-semibold text-accent">Unicess</b>&nbsp; / &nbsp;Admissions email, answered by agents
          </div>
          <h1 className="mt-5.5 text-[clamp(40px,5.4vw,70px)] leading-[1.02] font-semibold tracking-[-0.045em]">
            {LEAD.map((w, i) => word(w, i))}
            {ACCENT.map((w, i) => word(w, i + LEAD.length, true))}
          </h1>
          <p data-reveal className="mt-6.5 max-w-[560px] text-[19px] leading-[1.55] text-ink2">
            Unicess gives each university office its own email agent. They share one applicant file, answer together in a single
            reply, and bring in staff only when a decision needs a person.
          </p>
          <div data-reveal className="mt-9 flex flex-wrap gap-3">
            <a href={`${APP_URL}/login`} className="inline-flex items-center gap-3 bg-accent px-[22px] py-3.5 text-[15px] font-semibold text-accent-ink transition-colors hover:brightness-110">
              Start <span className="go" aria-hidden />
            </a>
            <a href="#how" className="inline-flex items-center border border-rule-strong px-[22px] py-3.5 text-[15px] font-semibold transition-colors hover:border-ink">
              See how it works
            </a>
          </div>
          <div data-reveal className="mt-7 flex flex-wrap gap-x-2.5 font-mono text-xs leading-[1.6] tracking-[0.02em] text-faint">
            <span>Running at Halden University</span>
            <span className="text-rule-strong">·</span>
            <span>6 office addresses</span>
            <span className="text-rule-strong">·</span>
            <span>Built on Primitive</span>
          </div>
        </div>
        <div className="hero-shot -mb-px max-lg:mb-0 [.js_&]:invisible">
          <ReplyTimeline />
        </div>
      </div>
    </header>
  );
}
