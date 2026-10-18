"use client";
import { useRef } from "react";
import { MOTION_OFF, MOTION_OK, gsap, useGSAP } from "@/lib/gsap";

const TICKS = [
  "Approve or edit an agent's draft in one step",
  "Applicant files with checklist, documents and deadlines",
  "Every blocked attack, with the evidence quoted",
  "Sign in with your university Google account",
];

// The review queue plays one decision when it scrolls into view: the draft is approved and goes out.
export function PortalPreview() {
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo("[data-reveal]", { y: 26, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.85, stagger: 0.07, ease: "power3.out", scrollTrigger: { trigger: ref.current, start: "top 78%" } });
        const tl = gsap.timeline({ scrollTrigger: { trigger: ".queue", start: "top 65%" }, delay: 0.5 });
        tl.to(".approve", { scale: 0.96, duration: 0.12, yoyo: true, repeat: 1, ease: "power1.inOut" })
          .to(".chip-wait", { autoAlpha: 0, duration: 0.2 }, "+=0.05")
          .fromTo(".chip-done", { autoAlpha: 0, y: 6 }, { autoAlpha: 1, y: 0, duration: 0.3 }, "<")
          .call(() => {
            const count = ref.current?.querySelector(".count");
            if (count) count.textContent = "1 waiting";
          }, [], "<")
          .fromTo(".sent", { height: 0, autoAlpha: 0 }, { height: "auto", autoAlpha: 1, duration: 0.45, ease: "power2.out" }, "+=0.05")
          .to(".acts", { autoAlpha: 0.35, duration: 0.3 }, "<");
      });
      mm.add(MOTION_OFF, () => gsap.set("[data-reveal]", { autoAlpha: 1 }));
    },
    { scope: ref },
  );

  return (
    <section ref={ref} id="portal" className="border-b border-rule py-26 max-sm:py-18">
      <div className="mx-auto grid max-w-[1240px] grid-cols-2 items-center gap-18 px-8 max-lg:grid-cols-1 max-lg:gap-10 max-sm:px-4">
        <div>
          <div data-reveal className="font-mono text-xs tracking-[0.1em] text-muted uppercase">Staff portal</div>
          <h2 data-reveal className="mt-4 mb-4.5 text-[clamp(30px,3.6vw,46px)] leading-[1.08] font-semibold tracking-[-0.035em]">
            A review queue, not another inbox.
          </h2>
          <p data-reveal className="mb-5.5 text-[17px] text-ink2">
            Staff see only what needs a person: drafts to approve and questions to answer. An answer given once is saved to that
            office&apos;s knowledge, so the next applicant who asks is answered with no human.
          </p>
          <ul className="m-0 list-none border-t border-rule p-0">
            {TICKS.map((t) => (
              <li key={t} data-reveal className="grid grid-cols-[22px_minmax(0,1fr)] gap-2.5 border-b border-rule py-3.5 text-[15.5px]">
                <span className="mt-2 h-2.5 w-2.5 bg-accent" />
                {t}
              </li>
            ))}
          </ul>
        </div>

        <div data-reveal className="queue border border-rule bg-panel" aria-hidden>
          <div className="flex justify-between border-b border-rule px-5 py-3.5 font-mono text-[11px] tracking-[0.1em] text-muted uppercase">
            <span>Review queue</span>
            <b className="count text-signal">2 waiting</b>
          </div>
          <div className="px-5 py-4.5">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="relative inline-grid">
                <span className="chip-wait col-start-1 row-start-1 border border-current px-1.5 py-1 font-mono text-[10.5px] leading-none font-semibold tracking-[0.1em] text-warn">APPROVAL</span>
                <span className="chip-done invisible col-start-1 row-start-1 border border-current px-1.5 py-1 font-mono text-[10.5px] leading-none font-semibold tracking-[0.1em] text-accent">APPROVED</span>
              </span>
              <span className="font-semibold">Priya Sharma</span>
              <span className="font-mono text-xs text-finaid">finaid@</span>
              <span className="ml-auto font-mono text-[11.5px] text-faint">4 min</span>
            </div>
            <p className="mt-2.5 mb-0 text-[15px] text-ink2">Requests an application fee waiver.</p>
            <div className="mt-2 font-mono text-[11.5px] text-warn">Why it needs you: keyword rule, request check, office policy</div>
            <div className="mt-3 border-l-2 border-rule-strong bg-paper px-3 py-2.5 text-sm text-ink2">
              Your $75 application fee is waived. You can submit your application without payment.
            </div>
            <div className="acts mt-3.5 flex gap-2">
              <span className="approve bg-ink px-3.5 py-2.5 text-[13px] leading-none font-semibold text-paper">Approve and send</span>
              <span className="border border-rule-strong px-3.5 py-2.5 text-[13px] leading-none font-semibold">Edit</span>
            </div>
            <div className="sent h-0 overflow-hidden opacity-0">
              <div className="mt-3 text-[13.5px] text-ink2">
                <b className="text-accent">Sent</b> to Priya in her thread, from finaid@, 6:31 AM.
              </div>
            </div>
          </div>
          <div className="border-t border-rule px-5 py-4.5">
            <div className="flex flex-wrap items-baseline gap-3">
              <span className="border border-current px-1.5 py-1 font-mono text-[10.5px] leading-none font-semibold tracking-[0.1em] text-counselor">ANSWER NEEDED</span>
              <span className="font-semibold">Arjun Mehta</span>
              <span className="font-mono text-xs text-admissions">admissions@</span>
              <span className="ml-auto font-mono text-[11.5px] text-faint">11 min</span>
            </div>
            <p className="mt-2.5 mb-0 text-[15px] text-ink2">If I&apos;m admitted for Fall 2027, can I defer my start to Spring 2028?</p>
          </div>
        </div>
      </div>
    </section>
  );
}
