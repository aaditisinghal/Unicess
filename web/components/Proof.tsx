"use client";
import { useRef } from "react";
import { MOTION_OFF, MOTION_OK, gsap, useGSAP } from "@/lib/gsap";

const STATS = [
  { value: 6.7, decimals: 1, unit: "s", label: "to the first reply, across three offices" },
  { value: 75, decimals: 0, unit: "%", label: "of replies sent with no staff involved" },
  { value: 1, decimals: 0, unit: "", label: "applicant file, shared by every office" },
  { value: 0, decimals: 0, unit: "", label: "answers invented: unknowns go to staff" },
];

// The numbers count up once, as the row comes into view.
export function Proof() {
  const ref = useRef<HTMLElement>(null);
  useGSAP(
    () => {
      const nums = gsap.utils.toArray<HTMLElement>("[data-count]");
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        nums.forEach((el) => {
          const target = Number(el.dataset.count), decimals = Number(el.dataset.decimals);
          const n = { v: 0 };
          gsap.to(n, {
            v: target,
            duration: 1.4,
            ease: "power2.out",
            scrollTrigger: { trigger: ref.current, start: "top 85%" },
            onUpdate: () => {
              el.textContent = n.v.toFixed(decimals);
            },
          });
        });
        gsap.fromTo("[data-reveal]", { y: 20, autoAlpha: 0 }, { y: 0, autoAlpha: 1, duration: 0.8, stagger: 0.08, ease: "power3.out", scrollTrigger: { trigger: ref.current, start: "top 85%" } });
      });
      mm.add(MOTION_OFF, () => {
        nums.forEach((el) => (el.textContent = Number(el.dataset.count).toFixed(Number(el.dataset.decimals))));
        gsap.set("[data-reveal]", { autoAlpha: 1 });
      });
    },
    { scope: ref },
  );

  return (
    <section ref={ref} className="border-b border-rule">
      <div className="mx-auto grid max-w-[1240px] grid-cols-4 px-8 max-lg:grid-cols-2 max-sm:px-4">
        {STATS.map((s, i) => (
          <div
            key={s.label}
            data-reveal
            className={`py-9 pr-7 ${i > 0 ? "border-l border-rule pl-7" : ""} max-lg:[&:nth-child(3)]:border-l-0 max-lg:[&:nth-child(3)]:pl-0 max-lg:[&:nth-child(n+3)]:border-t max-sm:py-6 max-sm:pr-3 max-sm:[&:nth-child(even)]:pl-4`}
          >
            <div className="text-[44px] leading-none font-semibold tracking-[-0.04em] max-sm:text-[34px]">
              <span data-count={s.value} data-decimals={s.decimals}>{s.value.toFixed(s.decimals)}</span>
              {s.unit && <small className="ml-0.5 text-xl font-medium tracking-normal text-muted">{s.unit}</small>}
            </div>
            <div className="mt-2.5 text-[14.5px] text-ink2">{s.label}</div>
          </div>
        ))}
      </div>
      <div className="mx-auto max-w-[1240px] px-8 pb-5.5 font-mono text-[11px] tracking-[0.04em] text-faint max-sm:px-4">
        Measured on the ten-scenario Halden demo run.
      </div>
    </section>
  );
}
