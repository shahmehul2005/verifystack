import Link from "next/link";
import { Logo } from "@/components/brand/logo";
import { AccountNav } from "@/components/marketing/account-nav";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { FRAME } from "@/lib/frame";
import { FOOTER_NAV, SITE } from "@/lib/site";
import { cn } from "@/lib/cn";

const NAV = [
  { href: "/#how-it-works", label: "How it works" },
  { href: "/#capabilities", label: "Capabilities" },
  { href: "/#schemes", label: "Schemes" },
  { href: "/#trust", label: "Trust" },
  { href: "/#faq", label: "FAQ" },
] as const;

export default async function MarketingLayout({ children }: { children: React.ReactNode }) {
  const year = new Date().getFullYear();
  const email = await currentEmail();

  return (
    <div className="flex min-h-screen flex-col text-mist-900">
      <div className="sticky top-0 z-30 bg-mist-100">
        <header className={cn(FRAME, "relative flex h-[4.5rem] items-center justify-between gap-4")}>
          <Link href="/" aria-label="VerifyStack home" className="rounded-md">
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 text-base text-mist-700 lg:flex">
            {NAV.map((item) => (
              <Link key={item.href} href={item.href} className="px-3.5 py-2 transition-colors hover:text-mist-950">
                {item.label}
              </Link>
            ))}
          </nav>
          <AccountNav initialEmail={email} items={NAV} />
        </header>
      </div>

      <div className="flex-1">{children}</div>

      <SiteFooter year={year} signedIn={Boolean(email)} />
    </div>
  );
}

/** Who is signed in, if anyone. Never throws: the public site must render without a backend. */
async function currentEmail(): Promise<string | null> {
  try {
    const supabase = await createServerSupabase();
    if (!supabase) return null;
    const {
      data: { user },
    } = await supabase.auth.getUser();
    return user?.email ?? null;
  } catch {
    return null;
  }
}

/** The last rows of a board: filled tiles, every cell used. */
function SiteFooter({ year, signedIn }: { year: number; signedIn: boolean }) {
  const groups = FOOTER_NAV.map((group) =>
    group.title === "Get started" && signedIn
      ? {
          title: group.title,
          links: [
            { label: "Open workbench", href: "/engagements" },
            { label: "Request a demo", href: "/#demo" },
          ],
        }
      : group
  );

  return (
    <footer className="pb-5 sm:pb-8">
      <div className={cn(FRAME, "grid gap-2 lg:grid-cols-12")}>
        <div className="flex min-h-64 flex-col justify-between gap-10 bg-mist-200 p-7 lg:col-span-5">
          <Link href="/" aria-label="VerifyStack home" className="inline-block self-start">
            <Logo />
          </Link>
          <p className="max-w-md text-[1.25rem] leading-snug text-mist-900 sm:text-[1.5rem]">
            From evidence to a signed, reproducible report, for CCTS and ADEETIE.
          </p>
        </div>

        <div className="flex min-h-64 flex-col justify-between gap-10 bg-teal-600 p-7 text-white lg:col-span-4">
          <p className="max-w-xs text-[1.125rem] text-teal-50">AI proposes. People decide.</p>
          <div>
            {SITE.contactEmail ? (
              <a href={`mailto:${SITE.contactEmail}`} className="text-[clamp(1.5rem,1rem+1.6vw,2.5rem)] leading-tight font-medium underline-offset-4 hover:underline">
                {SITE.contactEmail}
              </a>
            ) : (
              <Link href="/#demo" className="text-[clamp(1.5rem,1rem+1.6vw,2.5rem)] leading-tight font-medium underline-offset-4 hover:underline">
                Talk to us
              </Link>
            )}
          </div>
        </div>

        <div className="bg-mist-50 p-7 text-base leading-relaxed text-mist-700 lg:col-span-3">
          <p>Independent software for verification firms, made in India.</p>
          <p className="mt-3 text-mist-500">© {year} {SITE.name}</p>
        </div>

        {groups.map((group) => (
          <nav key={group.title} aria-label={group.title} className="bg-mist-200 p-7 lg:col-span-3">
            <p className="text-[1.125rem] font-medium text-mist-950">{group.title}</p>
            <ul className="mt-4 space-y-2 text-base">
              {group.links.map((link) => (
                <li key={link.label}>
                  <Link href={link.href} className="text-mist-800 transition-colors hover:text-teal-800 hover:underline underline-offset-4">
                    {link.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        ))}

        <div className="bg-mist-50 p-7 lg:col-span-12">
          <p className="max-w-[64ch] text-base leading-relaxed text-mist-600">
            VerifyStack is independent software for verification firms. It is not affiliated with, endorsed by or certified by the Bureau of Energy Efficiency, the Ministry of New and Renewable Energy, the European Commission or any other regulator, and it does not give legal or regulatory advice. Scheme names are used only to say which schemes the product supports.
          </p>
          <ul className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-base text-mist-700">
            {[
              ["Privacy", "/privacy"],
              ["Terms", "/terms"],
              ["Security", "/security"],
              ["Licences", "/licenses"],
            ].map(([label, href]) => (
              <li key={href}>
                <Link href={href} className="underline-offset-4 hover:text-mist-950 hover:underline">
                  {label}
                </Link>
              </li>
            ))}
          </ul>
          <p className="mt-5 max-w-[64ch] text-[1rem] leading-relaxed text-mist-600">
            Photograph:{" "}
            <a
              href="https://commons.wikimedia.org/wiki/File:Bomanwille_limestone_quarry_%26_cement_factory_panorama.jpg"
              className="underline underline-offset-4 hover:text-mist-950"
            >
              Bomanwille limestone quarry &amp; cement factory panorama
            </a>{" "}
            by Scott Vaughan,{" "}
            <a href="https://creativecommons.org/licenses/by/2.0" className="underline underline-offset-4 hover:text-mist-950">
              CC BY 2.0
            </a>
            , via Wikimedia Commons. Shown in greyscale.
          </p>
        </div>
      </div>
    </footer>
  );
}
