import { APP_URL } from "@/lib/app-url";
import { Reveal } from "./Reveal";

export function FinalCta() {
  return (
    <div className="ink">
      <section className="py-28 max-sm:py-20">
        <Reveal className="mx-auto flex max-w-[1240px] flex-wrap items-end justify-between gap-10 px-8 max-sm:px-4">
          <div data-reveal>
            <div className="font-mono text-xs tracking-[0.1em] text-muted uppercase">Staff portal</div>
            <h2 className="mt-4 max-w-[760px] text-[clamp(36px,4.6vw,60px)] leading-[1.04] font-semibold tracking-[-0.04em]">
              See your applicants answered, and review only what needs you.
            </h2>
          </div>
          <a data-reveal href={`${APP_URL}/login`} className="inline-flex items-center gap-3 bg-accent px-[22px] py-3.5 text-[15px] font-semibold text-accent-ink transition-colors hover:brightness-110">
            Start <span className="go" aria-hidden />
          </a>
        </Reveal>
      </section>
      <footer className="pt-7 pb-10">
        <div className="mx-auto flex max-w-[1240px] flex-wrap justify-between gap-5 px-8 text-[13px] text-muted max-sm:px-4">
          <span>Unicess. Halden University is a fictional institution used for this demonstration.</span>
          <span>
            <a href={`${APP_URL}/llms.txt`} className="hover:text-ink">llms.txt</a>
            <span className="mx-2.5 text-rule-strong">·</span>
            <a href={`${APP_URL}/login`} className="hover:text-ink">Staff sign-in</a>
          </span>
        </div>
      </footer>
    </div>
  );
}
