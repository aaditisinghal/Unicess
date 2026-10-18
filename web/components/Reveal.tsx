"use client";
import { type ReactNode, useRef } from "react";
import { MOTION_OFF, MOTION_OK, gsap, useGSAP } from "@/lib/gsap";

// Fades and lifts every [data-reveal] child into place, in order, as the block scrolls into view.
export function Reveal({ children, className, stagger = 0.08, y = 28, start = "top 82%" }: {
  children: ReactNode;
  className?: string;
  stagger?: number;
  y?: number;
  start?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useGSAP(
    () => {
      const items = ref.current?.querySelectorAll<HTMLElement>("[data-reveal]");
      if (!items?.length) return;
      const mm = gsap.matchMedia();
      mm.add(MOTION_OK, () => {
        gsap.fromTo(
          items,
          { y, autoAlpha: 0 },
          { y: 0, autoAlpha: 1, duration: 0.9, ease: "power3.out", stagger, scrollTrigger: { trigger: ref.current, start } },
        );
      });
      mm.add(MOTION_OFF, () => gsap.set(items, { autoAlpha: 1 }));
    },
    { scope: ref },
  );
  return (
    <div ref={ref} className={className}>
      {children}
    </div>
  );
}
