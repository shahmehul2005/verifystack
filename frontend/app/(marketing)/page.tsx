import Image from "next/image";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/cn";
import { FRAME } from "@/lib/frame";
import { listPacks } from "@verifystack/backend/domain/packs";
import { DemoRequestForm } from "@/components/marketing/demo-request-form";
import { FaqIndex } from "@/components/marketing/faq-index";
import { HeroReader } from "@/components/marketing/hero-reader";
import { HowItWorks } from "@/components/marketing/how-it-works";
import { Outputs } from "@/components/marketing/outputs";

const STEPS = [
  {
    n: "01",
    title: "Plan",
    body: "Rate the risk factors, set the sampling policy and get the plan approved. Every save is a new version.",
  },
  {
    n: "02",
    title: "Collect",
    body: "PDFs, scans, spreadsheets, SCADA exports and evidence packs, plus site observations, photos and meter readings.",
  },
  {
    n: "03",
    title: "Review",
    body: "Values arrive with their source. Declared figures are compared with the evidence and a person decides.",
  },
  {
    n: "04",
    title: "Calculate",
    body: "A versioned, hashed engine computes from accepted facts only, using the method the scheme prescribes.",
  },
  {
    n: "05",
    title: "Resolve",
    body: "Findings become issues. The entity answers through a link, and the verifier checks the response.",
  },
  {
    n: "06",
    title: "Sign and submit",
    body: "An independent technical review, two named sign-offs and a hashed submission package.",
  },
] as const;

const PRINCIPLES = [
  {
    title: "Code computes",
    body: "The calculation engine is versioned and hashed. Language models never perform arithmetic.",
  },
  {
    title: "No value without provenance",
    body: "A page, a cell, a time range or a site observation. Without one of those, the value is refused.",
  },
  {
    title: "AI proposes, people decide",
    body: "Material values always need a named reviewer. Nothing approves them automatically.",
  },
  {
    title: "Rules observe, never conclude",
    body: "Reconciliation rules raise findings for a verifier to judge. Drafts cannot invent numbers.",
  },
  {
    title: "Separation of duties",
    body: "The person who observed does not accept it, and a drafter does not review. Two people sign.",
  },
  {
    title: "Reproducible runs",
    body: "Every run records the engine version, pack version and a hash of its inputs, chained to the last.",
  },
] as const;

const TRUST = [
  {
    title: "Isolated per firm",
    body: "Row-level security on every tenant table. Signed-in users can read their firm's rows and write nothing directly.",
  },
  {
    title: "Append-only record",
    body: "Audit events, facts, runs and sign-offs cannot be edited or deleted, even by the server.",
  },
  {
    title: "Content-addressed evidence",
    body: "Files are hashed on arrival and stored privately under that hash. Their type is read from the bytes.",
  },
  {
    title: "Capability-checked",
    body: "Four roles, one capability map, checked by the menu, the page and the route.",
  },
] as const;

const FAQ = [
  {
    q: "Who is VerifyStack for?",
    a: "Verification firms and energy auditors working on India's BEE schemes. It is built for the verifier and is never sold to the audited entity.",
  },
  {
    q: "Does the AI calculate anything?",
    a: "No. Models classify documents and propose field values with their source location. Only values a person accepts become facts, and only deterministic code turns facts into results.",
  },
  {
    q: "Can values be accepted in bulk?",
    a: "Only low-risk ones, and only after a sample has been reviewed clean. The sample size follows the approved verification plan. Anything material, below the confidence threshold or contradicting a declared figure always goes to a person. Each batch is audit-logged, and the share accepted in bulk is disclosed in the submission package.",
  },
  {
    q: "What does the entity see?",
    a: "Only the one issue addressed to them, through a single-use link. They can write a response and attach files. They get no account, and they cannot see other issues, calculations or engagements.",
  },
  {
    q: "Does it work on site without a connection?",
    a: "Text observations and meter readings are queued on the device and sync when the connection returns, without duplicates. Photos need a connection at the moment of capture.",
  },
  {
    q: "Is a technical review required?",
    a: "That depends on the scheme and the accreditation rules, so it is a setting on each methodology pack. When it is on, the review must come from someone who did not draft or accept the findings, and a changed calculation makes an earlier approval stale.",
  },
  {
    q: "Can it produce the filing in the regulator's format?",
    a: "Not yet. The submission package is a generic, hashed bundle of the report, findings, accepted facts and evidence manifest, and it says so. Scheme-specific layouts will be added once the portal formats are confirmed.",
  },
  {
    q: "Where do uploaded files go?",
    a: "Files are stored in your firm's workspace. When a Gemini API key is configured for your deployment, evidence may be sent to Google Gemini for classification and extraction. Extracted values are not used to train models in this application.",
  },
] as const;

const IN_DESIGN = [
  {
    name: "CBAM",
    body: "Embedded-emissions verification for installations. The flow and data model are drawn; the calculation rules, default values and verification requirements wait for a primary source and a practitioner.",
  },
  {
    name: "Green hydrogen",
    body: "Emission intensity per kilogram of hydrogen against a threshold. The boundary, renewable-matching rules and certificate format are still to be confirmed before anything is built on them.",
  },
] as const;

const CCTS_POINTS = [
  "Greenhouse-gas emissions intensity against the notified target",
  "Scope 1 and Scope 2 streams bound to accepted facts",
  "Planning, site fieldwork and technical review built in",
  "Clause-referenced reconciliation rules and findings",
];

const ADEETIE_POINTS = [
  "Energy audit, DPR and M&V as stages you can track",
  "Specific energy consumption baseline and savings gate",
  "Measures with savings and simple payback",
  "Eligibility checks for cluster, loan size and debt share",
];

const H2 = "max-w-3xl text-[clamp(2rem,1rem+2.6vw,3.5rem)] leading-[1.03] font-medium tracking-[-0.03em]";
const LEAD = "mt-6 max-w-xl text-[1.25rem] leading-relaxed";

const delay = (ms: number) => ({ "--d": `${ms}ms` }) as React.CSSProperties;

const squareButton = (variant: "primary" | "secondary" = "primary") =>
  cn(buttonVariants({ size: "lg", variant }), "rounded-none px-6");

export default function MarketingPage() {
  const packs = listPacks();
  const ccts = packs.filter((p) => p.scheme === "CCTS");
  const adeetie = packs.filter((p) => p.scheme === "ADEETIE");
  const runnable = (list: typeof packs) => list.filter((p) => p.status === "runnable").length;

  return (
    <main>
      {/* Hero: the page reads itself. Two tones meet at the middle. */}
      <section className="relative">
        <div aria-hidden className="absolute inset-y-0 right-0 hidden w-1/2 bg-mist-50 xl:block" />
        <div className={cn(FRAME, "relative grid items-center gap-x-16 gap-y-12 py-14 xl:min-h-[calc(100svh-4.5rem)] xl:grid-cols-2 xl:py-20")}>
          <div>
            <h1 className="text-[clamp(2rem,1rem+2.6vw,3.5rem)] leading-[0.98] font-medium tracking-[-0.035em] text-mist-950">
              <span className="line">
                <span style={delay(60)}>Verification that</span>
              </span>
              <span className="line">
                <span style={delay(170)}>shows its working.</span>
              </span>
            </h1>
            <p className="rise mt-7 max-w-lg text-[1.25rem] leading-relaxed text-mist-800" style={delay(420)}>
              Every value traced to its page, every number computed by code, every decision signed by a named person.
            </p>
            <div className="rise mt-9 flex flex-wrap items-center gap-x-7 gap-y-4" style={delay(480)}>
              <Link href="/#demo" className={squareButton()}>
                Request a demo
              </Link>
              <Link href="/signup" className="font-medium text-teal-700 underline underline-offset-4 hover:text-teal-900">
                Create your firm&apos;s account
              </Link>
            </div>
            <p className="rise mt-9 max-w-md text-[1rem] leading-relaxed text-mist-600" style={delay(540)}>
              Built for verification firms and energy auditors working under CCTS and ADEETIE. Never sold to the audited entity.
            </p>
          </div>
          <div className="rise xl:pl-4" style={delay(300)}>
            <HeroReader />
          </div>
        </div>
      </section>

      {/* Four facts, as one quiet row. */}
      <section aria-label="In numbers" className="bg-mist-200 py-14 lg:py-20">
        <dl className={cn(FRAME, "grid grid-cols-2 gap-x-10 gap-y-10 lg:grid-cols-4")}>
          {[
            ["4", "evidence types, each with provenance"],
            ["0", "numbers produced by a model"],
            ["2", "named people to sign a report"],
            [String(packs.length), "methodology packs, held as data"],
          ].map(([value, label]) => (
            <div key={label} className="reveal">
              <dd className="tabular text-[clamp(2.75rem,1.5rem+3.6vw,4.75rem)] leading-none font-medium tracking-[-0.04em] text-mist-950">{value}</dd>
              <dt className="mt-3 max-w-[16rem] text-[1.125rem] leading-snug text-mist-800">{label}</dt>
            </div>
          ))}
        </dl>
      </section>

      {/* How it works: one engagement, pinned, changing state. */}
      <section id="how-it-works" className="scroll-mt-20 py-24 lg:py-32">
        <div className={FRAME}>
          <h2 className={cn(H2, "reveal text-mist-950")}>From plan to signed submission.</h2>
          <p className={cn(LEAD, "reveal text-mist-800")}>One path, whatever the scheme. The methodology pack decides what each step requires.</p>
          <div className="mt-14">
            <HowItWorks steps={STEPS} />
          </div>
        </div>
      </section>

      {/* Outputs: the documents, as an index with a live sheet. */}
      <section id="capabilities" className="scroll-mt-20 pb-24 lg:pb-32">
        <div className={FRAME}>
          <h2 className={cn(H2, "reveal text-mist-950")}>The documents it produces.</h2>
          <p className={cn(LEAD, "reveal text-mist-800")}>
            Not a document viewer with a model bolted on. Each part exists because a verifier has to answer for it.
          </p>
          <div className="mt-14">
            <Outputs />
          </div>
        </div>
      </section>

      {/* The world the work happens in. */}
      <section aria-label="A cement works" className="pb-24 lg:pb-32">
        <figure className={FRAME}>
          <div className="relative aspect-[4/3] w-full overflow-hidden bg-mist-300 sm:aspect-[16/9] lg:aspect-[21/9]">
            <Image
              src="/images/limestone-quarry-cement-works.jpg"
              alt="A cement works beside a flooded limestone quarry at dusk, with storage silos and long conveyor belts"
              fill
              sizes="(min-width: 1536px) 1440px, 100vw"
              className="object-cover object-[50%_62%] grayscale contrast-105"
            />
          </div>
          <figcaption className="mt-4 max-w-xl text-[1rem] leading-relaxed text-mist-700">
            A limestone quarry and cement works, the kind of site a CCTS cement engagement covers.
          </figcaption>
        </figure>
      </section>

      {/* Principles: what the product will not do. */}
      <section id="principles" className="scroll-mt-20 pb-24 lg:pb-32">
        <div className={cn(FRAME, "grid gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]")}>
          <div className="lg:sticky lg:top-28 lg:self-start">
            <h2 className={cn(H2, "reveal text-mist-950")}>Built to be checked.</h2>
            <p className={cn(LEAD, "reveal text-mist-800")}>
              Every result can be traced back to a source and a person. These are the rules the product will not bend.
            </p>
          </div>
          <ul className="space-y-10">
            {PRINCIPLES.map(({ title, body }) => (
              <li key={title} className="reveal">
                <h3 className="text-[clamp(1.5rem,1rem+1.6vw,2.5rem)] leading-[1.1] font-medium tracking-[-0.02em] text-mist-950">{title}</h3>
                <p className="mt-3 max-w-xl text-[1.125rem] leading-relaxed text-mist-800">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Schemes: two live, two designed. */}
      <section id="schemes" className="scroll-mt-20 bg-mist-200 py-24 lg:py-32">
        <div className={FRAME}>
          <h2 className={cn(H2, "reveal text-mist-950")}>Two schemes live, two designed.</h2>
          <p className={cn(LEAD, "reveal text-mist-800")}>
            Sector methodology lives in packs, as data, and the engine never branches on sector. A scheme without checked content stays marked as such.
          </p>
          <div className="mt-14 grid gap-x-16 gap-y-14 md:grid-cols-2">
            {[
              { name: "CCTS", full: "Carbon Credit Trading Scheme", list: ccts, points: CCTS_POINTS },
              { name: "ADEETIE", full: "BEE scheme for energy efficiency in MSMEs", list: adeetie, points: ADEETIE_POINTS },
            ].map((s) => (
              <article key={s.name} className="reveal">
                <h3 className="text-[clamp(2rem,1rem+2.6vw,3.5rem)] leading-none font-medium tracking-[-0.03em] text-mist-950">{s.name}</h3>
                <p className="mt-3 text-[1.125rem] text-mist-700">{s.full}</p>
                <p className="mt-1 text-[1.125rem] font-medium text-teal-800">
                  {runnable(s.list)} of {s.list.length} sector packs runnable
                </p>
                <ul className="mt-7 space-y-3 text-[1.125rem] leading-snug text-mist-900">
                  {s.points.map((p) => (
                    <li key={p}>{p}</li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
          <div className="mt-16 grid gap-x-16 gap-y-10 md:grid-cols-2">
            {IN_DESIGN.map((d) => (
              <article key={d.name} className="reveal">
                <h3 className="text-[1.5rem] font-medium tracking-[-0.02em] text-mist-950">{d.name}, in design</h3>
                <p className="mt-2 max-w-md text-[1.125rem] leading-relaxed text-mist-700">{d.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Trust: one dark band. */}
      <section id="trust" className="scroll-mt-20 bg-mist-900 py-24 text-mist-100 lg:py-32">
        <div className={cn(FRAME, "grid gap-x-16 gap-y-14 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]")}>
          <div>
            <h2 className={cn(H2, "reveal text-white")}>Plant data is not a demo asset.</h2>
            <p className={cn(LEAD, "reveal text-mist-300")}>
              Competing firms share this product, so isolation and an unalterable record are designed in, not added later. Controls we have not built yet are tracked, not hidden.
            </p>
            <div className="mt-8 flex flex-wrap gap-x-8 gap-y-3 text-[1.125rem] font-medium">
              <Link href="/security" className="text-white underline underline-offset-4 hover:text-teal-200">
                Security overview
              </Link>
              <Link href="/privacy" className="text-white underline underline-offset-4 hover:text-teal-200">
                Privacy notice
              </Link>
            </div>
          </div>
          <ul className="grid gap-x-12 gap-y-10 sm:grid-cols-2">
            {TRUST.map(({ title, body }) => (
              <li key={title} className="reveal">
                <h3 className="text-[1.5rem] leading-snug font-medium text-white">{title}</h3>
                <p className="mt-2 text-[1.125rem] leading-relaxed text-mist-300">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* FAQ: every question, one answer. */}
      <section id="faq" className="scroll-mt-20 py-24 lg:py-32">
        <div className={FRAME}>
          <h2 className={cn(H2, "reveal text-mist-950")}>Questions firms ask first.</h2>
          <div className="mt-12">
            <FaqIndex items={FAQ} />
          </div>
        </div>
      </section>

      {/* Demo: the first step, already open. */}
      <section id="demo" className="scroll-mt-20 bg-teal-600 py-20 text-white lg:py-28">
        <div className={cn(FRAME, "grid items-center gap-x-16 gap-y-12 lg:grid-cols-[minmax(0,6fr)_minmax(0,6fr)]")}>
          <div>
            <h2 className="max-w-xl text-[clamp(2rem,1rem+2.6vw,3.5rem)] leading-[1] font-medium tracking-[-0.035em]">
              See it on an engagement like yours.
            </h2>
            <p className="mt-7 max-w-md text-[1.25rem] leading-relaxed text-teal-50">
              Tell us which scheme you work on. We will walk through one engagement from the plan to the signed package, with your questions in mind.
            </p>
            <p className="mt-8 text-[1.125rem] text-teal-50">
              Prefer to start straight away?{" "}
              <Link href="/signup" className="font-medium text-white underline underline-offset-4">
                Create your firm&apos;s account
              </Link>
            </p>
          </div>
          <DemoRequestForm />
        </div>
      </section>
    </main>
  );
}
