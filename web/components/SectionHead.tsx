import type { ReactNode } from "react";

// Eyebrow and title on the left, a short lede on the right, aligned to the baseline.
export function SectionHead({ eyebrow, title, lede }: { eyebrow: string; title: ReactNode; lede: ReactNode }) {
  return (
    <div className="mb-13 grid grid-cols-2 items-end gap-12 max-lg:grid-cols-1 max-lg:gap-6">
      <div data-reveal>
        <div className="font-mono text-xs tracking-[0.1em] text-muted uppercase">{eyebrow}</div>
        <h2 className="mt-4 text-[clamp(30px,3.6vw,46px)] leading-[1.08] font-semibold tracking-[-0.035em]">{title}</h2>
      </div>
      <p data-reveal className="m-0 max-w-[520px] text-[17px] text-ink2">{lede}</p>
    </div>
  );
}
