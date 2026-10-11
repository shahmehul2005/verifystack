import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { SITE } from "@/lib/site";

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
    <main className="px-4 pt-12 pb-10 sm:px-6 sm:pt-20">
      <div className="mx-auto max-w-5xl">
        <p className="eyebrow text-teal-700">{kicker}</p>
        <h1 className="mt-3 text-4xl leading-[1.05] font-medium tracking-[-0.03em] text-mist-950 sm:text-5xl">
          {title}
        </h1>
        <p className="mt-4 max-w-2xl text-[17px] leading-relaxed text-mist-600">{intro}</p>
        <p className="eyebrow mt-5 text-mist-500">Last reviewed {SITE.legalUpdated}</p>

        <div className="mt-12 grid gap-8 lg:grid-cols-[13rem_minmax(0,1fr)]">
          <nav aria-label="On this page" className="hidden lg:block">
            <ul className="sticky top-28 space-y-2 border-l border-mist-900/10 pl-4 text-sm">
              {sections.map((s) => (
                <li key={s.id}>
                  <a href={`#${s.id}`} className="text-mist-500 hover:text-mist-950">
                    {s.title}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          <article className="glass rounded-3xl px-6 py-8 sm:px-10 sm:py-10">
            <div className="space-y-10">
              {sections.map((s) => (
                <section key={s.id} id={s.id} className="scroll-mt-28">
                  <h2 className="text-xl font-medium tracking-[-0.015em] text-mist-950">{s.title}</h2>
                  <div className="mt-3 space-y-4 text-[15px] leading-relaxed text-mist-700 [&_a]:font-medium [&_a]:text-teal-800 [&_a]:underline-offset-4 hover:[&_a]:underline [&_li]:pl-1 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-5">
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
          className="mt-10 inline-flex items-center gap-1.5 text-sm font-medium text-teal-800 hover:text-teal-950"
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
