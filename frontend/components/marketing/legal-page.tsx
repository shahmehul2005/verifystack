import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { FRAME } from "@/lib/frame";
import { SITE } from "@/lib/site";
import { cn } from "@/lib/cn";

export type LegalSection = {
  id: string;
  title: string;
  body: React.ReactNode;
};

/** Shared frame for the privacy, terms, security and licence pages. */
export function LegalPage({
  kicker,
  title,
  intro,
  sections,
  children,
}: {
  kicker: string;
  title: string;
  intro: string;
  sections: LegalSection[];
  children?: React.ReactNode;
}) {
  return (
    <main className="pt-12 pb-16 sm:pt-20">
      <div className={cn(FRAME)}>
        <h1 className="text-[clamp(2rem,1rem+2.6vw,3.5rem)] leading-[1.03] font-medium tracking-[-0.03em] text-mist-950">
          {title}
        </h1>
        <p className="mt-5 max-w-2xl text-[1.125rem] leading-relaxed text-mist-800">{intro}</p>
        <p className="mt-4 text-base text-mist-600">
          {kicker}. Last reviewed {SITE.legalUpdated}.
        </p>

        <div className="mt-12 grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <nav aria-label="On this page" className="hidden lg:block">
            <ul className="sticky top-28 space-y-2 text-base">
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-mist-600 hover:text-mist-950">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <article className="max-w-3xl">
            <div className="space-y-10">
              {sections.map((s) => (
                <section key={s.id} id={s.id} className="scroll-mt-28">
                  <h2 className="text-xl font-medium tracking-[-0.015em] text-mist-950">{s.title}</h2>
                  <div className="mt-3 space-y-4 text-[1.0625rem] leading-relaxed text-mist-800 [&_a]:font-medium [&_a]:text-teal-800 [&_a]:underline-offset-4 hover:[&_a]:underline [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
                    {s.body}
                  </div>
                </section>
              ))}
            </div>
            {children}
          </article>
        </div>

        <Link
          href="/"
          className="mt-12 inline-flex items-center gap-1.5 text-base font-medium text-teal-800 hover:text-teal-950"
        >
          <ArrowLeft aria-hidden className="size-4" />
          Back to home
        </Link>
      </div>
    </main>
  );
}

/** How to reach us, without inventing an address that is not configured. */
export function ContactLine({ topic }: { topic: string }) {
  return SITE.contactEmail ? (
    <>
      Write to <a href={`mailto:${SITE.contactEmail}`}>{SITE.contactEmail}</a> about {topic}.
    </>
  ) : (
    <>
      Use the <Link href="/#demo">request form</Link> and say that it is about {topic}.
    </>
  );
}
