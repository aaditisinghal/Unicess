import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";

const OFFICES = [
  ["ask", "Front desk", "Any question. Splits it across the right offices and returns one reply."],
  ["admissions", "Admissions", "Deadlines, requirements, application status, transcripts and the application fee."],
  ["intl", "International", "I-20 funding proof, bank statements, visas, English tests and sponsor letters."],
  ["finaid", "Financial aid", "Scholarships, cost of attendance, and fee waivers approved by a counselor."],
  ["housing", "Housing", "On-campus housing, deposits and housing deadlines."],
  ["counselor", "Application counselor", "What is still missing, with due dates. Sends reminders before deadlines, unprompted."],
] as const;

export function Offices() {
  return (
    <section id="offices" className="border-b border-rule py-26 max-sm:py-18">
      <Reveal className="mx-auto max-w-[1240px] px-8 max-sm:px-4" stagger={0.06}>
        <SectionHead
          eyebrow="Offices"
          title="Each office keeps its own address and its own voice."
          lede="Offices answer only what they own and sign their part of the reply. Policy lives in a knowledge file each office can read and edit."
        />
        <div className="border-t-2 border-ink">
          <div className="grid grid-cols-[34%_22%_minmax(0,1fr)] py-3.5 font-mono text-[11px] tracking-[0.1em] text-muted uppercase max-sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
            <span>Address</span>
            <span>Office</span>
            <span className="max-sm:hidden">Handles</span>
          </div>
          {OFFICES.map(([a, office, what]) => (
            <div
              key={a}
              data-reveal
              className="group grid grid-cols-[34%_22%_minmax(0,1fr)] items-baseline border-t border-rule py-4.5 text-[15.5px] text-ink2 transition-colors hover:bg-panel max-sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
            >
              <span className="flex items-center font-mono text-[15px] font-semibold text-ink">
                <i className="mr-3.5 inline-block h-[9px] w-[9px] transition-transform group-hover:scale-125" style={{ background: `var(--${a})` }} />
                {a}@
              </span>
              <span className="pr-6 font-semibold text-ink">{office}</span>
              <span className="max-sm:col-span-2 max-sm:mt-1 max-sm:text-sm">{what}</span>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
