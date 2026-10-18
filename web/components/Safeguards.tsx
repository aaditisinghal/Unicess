import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";

const GUARDS = [
  ["SIGNED", "Verified webhooks", "Every delivery is checked against its signature. A forged one is rejected before any agent reads it."],
  ["ONCE", "No duplicate replies", "Retried deliveries are recognised, so an applicant never receives the same answer twice."],
  ["LOOPS", "Auto-replies ignored", "Out-of-office and bounce messages are read from their headers and never answered."],
  ["SENDER", "Spoofing detected", "Mail that fails sender authentication is answered without touching the applicant's file."],
  ["INJECTION", "Documents stay data", "Instructions hidden in a PDF are quoted to staff, never followed."],
  ["APPROVAL", "People decide money", "Waivers, refunds, extensions and exceptions always wait for a counselor."],
] as const;

export function Safeguards() {
  return (
    <section id="safeguards" className="border-b border-rule py-26 max-sm:py-18">
      <Reveal className="mx-auto max-w-[1240px] px-8 max-sm:px-4" stagger={0.07}>
        <SectionHead
          eyebrow="Safeguards"
          title="Built for the inbox as it really is."
          lede="Applicant mail includes forwarded loops, spoofed senders and documents written to manipulate an AI. Each is stopped before an agent acts on it."
        />
        <div className="grid grid-cols-3 border-t border-l border-rule max-lg:grid-cols-2 max-sm:grid-cols-1">
          {GUARDS.map(([code, title, body]) => (
            <div key={code} data-reveal className="group border-r border-b border-rule px-6.5 pt-6.5 pb-7 transition-colors hover:bg-panel">
              <span className="border border-current px-1.5 py-1 font-mono text-[10.5px] leading-none font-semibold tracking-[0.1em] text-bad">{code}</span>
              <h3 className="mt-4.5 mb-1.5 text-lg font-semibold tracking-[-0.015em]">{title}</h3>
              <p className="m-0 text-[15px] text-ink2">{body}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
