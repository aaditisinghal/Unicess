"use client";
import Lenis from "lenis";
import { type ReactNode, useEffect } from "react";
import { MOTION_OFF, ScrollTrigger, gsap } from "@/lib/gsap";

// Lenis smooths the scroll, and GSAP's ticker drives it so ScrollTrigger animations stay in step.
export function SmoothScroll({ children }: { children: ReactNode }) {
  useEffect(() => {
    if (matchMedia(MOTION_OFF).matches) return;
    const lenis = new Lenis({ duration: 1.1, smoothWheel: true });
    lenis.on("scroll", ScrollTrigger.update);
    const tick = (time: number) => lenis.raf(time * 1000);
    gsap.ticker.add(tick);
    gsap.ticker.lagSmoothing(0);

    // In-page links glide to their section, clearing the sticky nav.
    const onClick = (e: MouseEvent) => {
      const link = (e.target as HTMLElement).closest<HTMLAnchorElement>('a[href^="#"]');
      const hash = link?.getAttribute("href");
      if (!hash || hash.length < 2) return;
      e.preventDefault();
      lenis.scrollTo(hash, { offset: -68 });
    };
    document.addEventListener("click", onClick);
    return () => {
      document.removeEventListener("click", onClick);
      gsap.ticker.remove(tick);
      lenis.destroy();
    };
  }, []);
  return <>{children}</>;
}
