"use client";
import { useRef } from "react";
import { APP_URL } from "@/lib/app-url";
import { MOTION_OFF, MOTION_OK, gsap, useGSAP } from "@/lib/gsap";

// The structured reply an applicant's AI agent receives, drawn line by line as it scrolls in.
const K = ({ children }: { children: string }) => <span className="text-intl">&quot;{children}&quot;</span>;
const S = ({ children }: { children: string }) => <span className="text-finaid">&quot;{children}&quot;</span>;
const N = ({ children }: { children: number }) => <span className="text-admissions">{children}</span>;
const LINES = [
  <>{"{"}</>,
  <>  <K>format</K>: <S>unicess/v1</S>,</>,
  <>  <K>next_step</K>: <S>Submit a signed sponsor letter</S>,</>,
  <>  <K>missing_items</K>: [</>,
  <>    {"{ "}<K>item</K>: <S>transcript</S>, <K>due</K>: <S>2027-01-15</S>{" },"}</>,
  <>    {"{ "}<K>item</K>: <S>sponsor_letter</S>, <K>due</K>: <S>2027-06-01</S>{" }"}</>,
  <>  ],</>,
  <>  <K>amounts</K>: [</>,
  <>    {"{ "}<K>label</K>: <S>Funding shortfall</S>, <K>usd</K>: <N>{15400}</N>{" },"}</>,
  <>    {"{ "}<K>label</K>: <S>Merit scholarship, maximum</S>, <K>usd</K>: <N>{8000}</N>{" }"}</>,
  <>  ]</>,
  <>{"}"}</>,
];

export function ForAgents() {
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo("[data-reveal]", { y: 24, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.85, stagger: 0.08, ease: "power3.out", scrollTrigger: { trigger: ref.current, start: "top 78%" } });
        gsap.fromTo("[data-line]", { autoAlpha: 0, x: -8 }, { autoAlpha: 1, x: 0, duration: 0.3, stagger: 0.07, ease: "power1.out", scrollTrigger: { trigger: ".json", start: "top 75%" } });
      });
      mm.add(MOTION_OFF, () => gsap.set("[data-reveal], [data-line]", { autoAlpha: 1 }));
    },
    { scope: ref },
  );

  return (
    <section ref={ref} id="agents" className="border-b border-rule py-26 max-sm:py-18">
      <div className="mx-auto grid max-w-[1240px] grid-cols-2 items-center gap-18 px-8 max-lg:grid-cols-1 max-lg:gap-10 max-sm:px-4">
        <div>
          <div data-reveal className="font-mono text-xs tracking-[0.1em] text-muted uppercase">For AI agents</div>
          <h2 data-reveal className="mt-4 mb-4.5 text-[clamp(30px,3.6vw,46px)] leading-[1.08] font-semibold tracking-[-0.035em]">
            Ready for the applicant&apos;s own AI assistant.
          </h2>
          <p data-reveal className="mb-5.5 text-[17px] text-ink2">
            Add <span className="font-mono">Reply format: structured</span> to any email and the reply carries a JSON block with
            deadlines, amounts, missing items and the next step. Discovery files tell assistants which address to write to.
          </p>
          <div data-reveal className="flex flex-wrap gap-2.5">
            {["/llms.txt", "/.well-known/agent.json"].map((p) => (
              <a key={p} href={`${APP_URL}${p}`} className="border border-rule-strong px-3 py-1.5 font-mono text-[13px] transition-colors hover:border-ink">
                {p}
              </a>
            ))}
          </div>
        </div>
        <pre data-reveal className="json m-0 overflow-x-auto border border-rule bg-panel px-6 py-5.5 font-mono text-[13px] leading-[1.7] text-ink2" aria-label="Example structured reply">
          {LINES.map((line, i) => (
            <span key={i} data-line className="block whitespace-pre [.js_&]:invisible">{line}</span>
          ))}
        </pre>
      </div>
    </section>
  );
}
