import Link from "next/link";
import { ArrowUpRight, Mail } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { AccountNav } from "@/components/marketing/account-nav";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { FOOTER_NAV, SITE } from "@/lib/site";

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
      <div className="sticky top-0 z-30 px-3 pt-3 sm:px-6">
        <header className="glass relative mx-auto flex h-14 max-w-6xl items-center justify-between gap-4 rounded-full pr-2 pl-5">
          <Link href="/" aria-label="VerifyStack home" className="rounded-md">
            <Logo />
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-1 text-sm text-mist-600 md:flex">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="rounded-full px-3.5 py-1.5 transition-colors hover:bg-mist-900/5 hover:text-mist-950"
              >
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
    <footer className="relative mt-10 px-3 pb-3 sm:px-6 sm:pb-6">
      <div className="glass relative mx-auto max-w-6xl overflow-hidden rounded-3xl">
        <div className="grid gap-12 px-7 pt-12 pb-10 sm:px-12 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,2.7fr)]">
          <div className="max-w-sm">
            <Link href="/" aria-label="VerifyStack home" className="inline-block rounded-md">
              <Logo />
            </Link>
            <p className="mt-5 text-[15px] leading-relaxed text-mist-600">
              The workbench verification firms use to take evidence to a signed, reproducible
              report under India&apos;s CCTS and ADEETIE schemes.
            </p>
            <p className="eyebrow mt-6 inline-flex items-center gap-2 rounded-full border border-mist-900/8 bg-white/60 px-3 py-1.5 text-mist-600">
              <span aria-hidden className="size-1.5 rounded-full bg-teal-600" />
              AI proposes · People decide
            </p>
            <div className="mt-6 text-sm">
              {SITE.contactEmail ? (
                <a
                  href={`mailto:${SITE.contactEmail}`}
                  className="inline-flex items-center gap-2 text-mist-700 hover:text-mist-950"
                >
                  <Mail aria-hidden className="size-4" />
                  {SITE.contactEmail}
                </a>
              ) : (
                <Link
                  href="/#demo"
                  className="inline-flex items-center gap-1.5 font-medium text-teal-800 hover:text-teal-950"
                >
                  Talk to us
                  <ArrowUpRight aria-hidden className="size-4" />
                </Link>
              )}
            </div>
          </div>

          <nav aria-label="Footer" className="grid grid-cols-2 gap-x-8 gap-y-10 sm:grid-cols-4">
            {groups.map((group) => (
              <div key={group.title}>
                <p className="eyebrow text-mist-500">{group.title}</p>
                <ul className="mt-4 space-y-2.5 text-sm">
                  {group.links.map((link) => (
                    <li key={link.label}>
                      <Link href={link.href} className="text-mist-700 transition-colors hover:text-mist-950">
                        {link.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </nav>
        </div>

        <div className="border-t border-mist-900/6 px-7 py-6 sm:px-12">
          <p className="max-w-4xl text-xs leading-relaxed text-mist-500">
            VerifyStack is independent software for verification firms. It is not affiliated with,
            endorsed by or certified by the Bureau of Energy Efficiency, the Ministry of New and
            Renewable Energy, the European Commission or any other regulator, and it does not give
            legal or regulatory advice. Scheme names are used only to say which schemes the product
            supports.
          </p>
          <div className="mt-5 flex flex-wrap items-center justify-between gap-x-6 gap-y-3 text-xs text-mist-500">
            <p>
              © {year} {SITE.name}. All rights reserved.
            </p>
            <ul className="flex flex-wrap items-center gap-x-5 gap-y-2">
              <li>
                <Link href="/privacy" className="hover:text-mist-900">
                  Privacy
                </Link>
              </li>
              <li>
                <Link href="/terms" className="hover:text-mist-900">
                  Terms
                </Link>
              </li>
              <li>
                <Link href="/security" className="hover:text-mist-900">
                  Security
                </Link>
              </li>
              <li>
                <Link href="/licenses" className="hover:text-mist-900">
                  Licences
                </Link>
              </li>
              <li className="text-mist-400">Made in India</li>
            </ul>
          </div>
        </div>

        <p
          aria-hidden
          className="font-display pointer-events-none -mb-6 px-6 text-center text-[clamp(4rem,17vw,12.5rem)] leading-[0.8] tracking-tight text-transparent select-none [-webkit-text-stroke:1px_rgb(12_22_21/0.09)] sm:-mb-10"
        >
          VerifyStack
        </p>
      </div>
    </footer>
  );
}
