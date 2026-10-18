import { Reveal } from "./Reveal";
import { SectionHead } from "./SectionHead";

const VERBS = [
  ["Identity", "Six addresses on one domain, one per office."],
  ["Ask and reply", "Threaded replies, follow-ups and questions back to the applicant."],
  ["Attachments", "PDFs and images read into the applicant's file."],
  ["Coordination", "Handoffs between offices, with state saved in Primitive Memories."],
] as const;

export function BuiltOn() {
  return (
    <section className="border-b border-rule py-26 max-sm:py-18">
      <Reveal className="mx-auto max-w-[1240px] px-8 max-sm:px-4">
        <SectionHead
          eyebrow="Built on Primitive"
          title="Email as the protocol between agents."
          lede="Every office is a real address on Primitive. Agents hand work to each other by email, and memory keeps one file per applicant."
        />
        <div className="grid grid-cols-4 border-t-2 border-ink max-lg:grid-cols-2 max-sm:grid-cols-1">
          {VERBS.map(([title, body], i) => (
            <div key={title} data-reveal className={`pt-5.5 pr-6 pb-1 ${i > 0 ? "border-l border-rule pl-6" : ""} max-lg:[&:nth-child(3)]:border-l-0 max-lg:[&:nth-child(3)]:pl-0 max-sm:border-l-0! max-sm:pl-0!`}>
              <b className="block font-mono text-xs font-semibold tracking-[0.08em] text-accent uppercase">{title}</b>
              <p className="mt-2.5 mb-0 text-[15px] text-ink2">{body}</p>
            </div>
          ))}
        </div>
      </Reveal>
    </section>
  );
}
