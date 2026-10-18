import { BuiltOn } from "@/components/BuiltOn";
import { FinalCta } from "@/components/FinalCta";
import { ForAgents } from "@/components/ForAgents";
import { Hero } from "@/components/Hero";
import { HowItWorks } from "@/components/HowItWorks";
import { Nav } from "@/components/Nav";
import { Offices } from "@/components/Offices";
import { PortalPreview } from "@/components/PortalPreview";
import { Proof } from "@/components/Proof";
import { Safeguards } from "@/components/Safeguards";

export default function Home() {
  return (
    <main id="top">
      {/* The nav sits directly in main so it stays pinned for the whole page, not just the hero. */}
      <Nav />
      <div className="ink">
        <Hero />
      </div>
      <Proof />
      <HowItWorks />
      <Offices />
      <PortalPreview />
      <Safeguards />
      <ForAgents />
      <BuiltOn />
      <FinalCta />
    </main>
  );
}
