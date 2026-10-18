import { APP_URL } from "@/lib/app-url";

const LINKS = [
  ["#how", "How it works"],
  ["#offices", "Offices"],
  ["#portal", "Staff portal"],
  ["#safeguards", "Safeguards"],
  ["#agents", "For AI agents"],
] as const;

export function Nav() {
  return (
    <nav className="ink sticky top-0 z-10 border-b border-rule">
      <div className="mx-auto flex h-17 max-w-[1240px] items-center justify-between gap-6 px-8 max-sm:px-4">
        <a href="#top" className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/logo.svg" alt="" width={30} height={30} className="block" />
          <b className="text-[19px] font-semibold tracking-[-0.02em]">Unicess</b>
        </a>
        <div className="flex gap-7 max-lg:hidden">
          {LINKS.map(([href, label]) => (
            <a key={href} href={href} className="text-sm text-muted transition-colors hover:text-ink">
              {label}
            </a>
          ))}
        </div>
        <a href={`${APP_URL}/login`} className="inline-flex items-center gap-3 bg-accent px-4.5 py-2.5 text-sm font-semibold text-accent-ink transition-colors hover:brightness-110">
          Start <span className="go" aria-hidden />
        </a>
      </div>
    </nav>
  );
}
