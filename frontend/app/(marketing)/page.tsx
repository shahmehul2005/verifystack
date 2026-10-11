import Link from "next/link";
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Calculator,
  Camera,
  Check,
  ClipboardCheck,
  FileArchive,
  FileSearch,
  Fingerprint,
  Flag,
  GitCompare,
  Layers,
  ListChecks,
  Lock,
  MapPin,
  MessageSquare,
  PenLine,
  ScrollText,
  ShieldCheck,
  Table2,
  UsersRound,
  WifiOff,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";
import { listPacks } from "@verifystack/backend/domain/packs";
import { DemoRequestForm } from "@/components/marketing/demo-request-form";

/* ------------------------------------------------------------------ */
/* Content                                                             */
/* ------------------------------------------------------------------ */

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
    icon: Calculator,
    title: "Code computes",
    body: "The calculation engine is versioned and hashed. Language models never perform arithmetic.",
  },
  {
    icon: FileSearch,
    title: "No value without provenance",
    body: "A page, a cell, a time range or a site observation. Without one of those, the value is refused.",
  },
  {
    icon: ShieldCheck,
    title: "AI proposes, people decide",
    body: "Material values always need a named reviewer. Nothing approves them automatically.",
  },
  {
    icon: Flag,
    title: "Rules observe, never conclude",
    body: "Reconciliation rules raise findings for a verifier to judge. Drafts cannot invent numbers.",
  },
  {
    icon: PenLine,
    title: "Separation of duties",
    body: "The person who observed does not accept it, and a drafter does not review. Two people sign.",
  },
  {
    icon: Layers,
    title: "Reproducible runs",
    body: "Every run records the engine version, pack version and a hash of its inputs, chained to the last.",
  },
] as const;

const TRUST = [
  {
    icon: Lock,
    title: "Isolated per firm",
    body: "Row-level security on every tenant table. Signed-in users can read their firm's rows and write nothing directly.",
  },
  {
    icon: ScrollText,
    title: "Append-only record",
    body: "Audit events, facts, runs and sign-offs cannot be edited or deleted, even by the server.",
  },
  {
    icon: Fingerprint,
    title: "Content-addressed evidence",
    body: "Files are hashed on arrival and stored privately under that hash. Their type is read from the bytes.",
  },
  {
    icon: UsersRound,
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

/* ------------------------------------------------------------------ */
/* Page                                                                */
/* ------------------------------------------------------------------ */

export default function MarketingPage() {
  const packs = listPacks();
  const ccts = packs.filter((p) => p.scheme === "CCTS");
  const adeetie = packs.filter((p) => p.scheme === "ADEETIE");
  const runnable = (list: typeof packs) => list.filter((p) => p.status === "runnable").length;

  return (
    <main>
      {/* Hero */}
      <section className="relative overflow-hidden">
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(rgb(12_22_21/0.09)_1px,transparent_1px)] bg-size-[22px_22px] mask-[radial-gradient(60%_60%_at_70%_30%,black,transparent)]"
        />
        <div className="mx-auto grid max-w-6xl items-center gap-16 px-6 pt-16 pb-20 lg:grid-cols-[minmax(0,1.05fr)_minmax(0,1fr)] lg:pt-24 lg:pb-28">
          <div>
            <Link
              href="/#capabilities"
              className="rise glass inline-flex items-center gap-2 rounded-full py-1 pr-3 pl-1 text-[13px] text-mist-700 hover:text-mist-950"
            >
              <span className="rounded-full bg-teal-700 px-2 py-0.5 text-[11px] font-medium text-white">
                New
              </span>
              Planning, fieldwork and technical review
              <ArrowRight aria-hidden className="size-3.5" />
            </Link>
            <h1
              className="rise mt-7 max-w-xl text-[2.9rem] leading-[1.02] font-medium tracking-[-0.035em] text-mist-950 sm:text-6xl lg:text-[4.1rem]"
              style={{ "--d": "80ms" } as React.CSSProperties}
            >
              Verification work that{" "}
              <em className="font-display text-[1.1em] font-normal tracking-[-0.02em] text-teal-800">
                shows its working.
              </em>
            </h1>
            <p
              className="rise mt-6 max-w-lg text-lg leading-relaxed text-mist-600"
              style={{ "--d": "160ms" } as React.CSSProperties}
            >
              One workbench takes an engagement from plan to evidence to a signed submission
              package, for CCTS and ADEETIE. Every value is traced to its source, every number is
              computed by code, and every decision has a name on it.
            </p>
            <div
              className="rise mt-9 flex flex-wrap gap-3"
              style={{ "--d": "240ms" } as React.CSSProperties}
            >
              <Link href="/#demo" className={cn(buttonVariants({ size: "lg" }), "rounded-full px-6")}>
                Request a demo
                <ArrowRight />
              </Link>
              <Link
                href="/signup"
                className={cn(buttonVariants({ size: "lg", variant: "secondary" }), "rounded-full px-6")}
              >
                Create your firm&apos;s account
              </Link>
            </div>
            <p
              className="rise eyebrow mt-8 text-mist-500"
              style={{ "--d": "320ms" } as React.CSSProperties}
            >
              For ACVAs · Energy auditors · Verification teams
            </p>
          </div>
          <div className="rise" style={{ "--d": "200ms" } as React.CSSProperties}>
            <EvidencePreview />
          </div>
        </div>

        <div className="mx-auto max-w-6xl px-6 pb-16">
          <dl className="glass grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-mist-900/6 sm:grid-cols-4">
            <Fact value="4" label="evidence types, each with provenance" />
            <Fact value="0" label="numbers produced by a model" />
            <Fact value="2" label="named people to sign a report" />
            <Fact value={String(packs.length)} label="methodology packs, as data" />
          </dl>
        </div>
      </section>

      {/* How it works */}
      <section id="how-it-works" className="scroll-mt-24 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            kicker="How it works"
            title={
              <>
                From a blank engagement to a <Accent>signed submission</Accent>
              </>
            }
            body="One path, whatever the scheme. The methodology pack decides what each step requires."
          />
          <ol className="reveal mt-12 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STEPS.map((s) => (
              <li key={s.n} className="glass rounded-2xl p-6">
                <span className="eyebrow text-teal-700">{s.n}</span>
                <h3 className="mt-3 text-lg font-medium tracking-tight text-mist-950">{s.title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-mist-600">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* Capabilities */}
      <section id="capabilities" className="scroll-mt-24 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            kicker="Capabilities"
            title={
              <>
                Everything between the evidence and <Accent>the report</Accent>
              </>
            }
            body="Not a document viewer with a model bolted on. Each part exists because a verifier has to answer for it."
          />

          <div className="mt-12 grid gap-4 lg:grid-cols-6">
            <Bento span="lg:col-span-4" icon={Fingerprint} title="Four kinds of evidence, one rule">
              <p>
                A fact is committed only with a source: a document page and region, a spreadsheet
                cell, a time range of meter data, or a site observation. Nothing else is accepted.
              </p>
              <ul className="mt-5 grid gap-2 sm:grid-cols-2">
                <Chip label="Page" source="p.3 · region · verbatim text" />
                <Chip label="Cell" source="Sheet2!D14 · formula kept" />
                <Chip label="Time range" source="kiln_kw · 1–30 Apr · 720 rows" />
                <Chip label="Observation" source="visit 2 · 14:32 · observer" />
              </ul>
            </Bento>

            <Bento span="lg:col-span-2" icon={GitCompare} title="Declared against evidence">
              <p>
                The workbook says one thing, the invoice another. The gap is shown, measured against
                a tolerance, and never accepted quietly.
              </p>
              <div className="mt-5 rounded-xl bg-white/70 p-3 text-xs ring-1 ring-mist-900/6">
                <div className="flex justify-between text-mist-600">
                  <span>Declared</span>
                  <span className="font-mono text-mist-900">18,247 t</span>
                </div>
                <div className="mt-1.5 flex justify-between text-mist-600">
                  <span>Extracted</span>
                  <span className="font-mono text-mist-900">18,724 t</span>
                </div>
                <div className="mt-2.5 flex items-center justify-between border-t border-mist-900/6 pt-2.5">
                  <Badge tone="draft" dot>
                    Mismatch 2.6%
                  </Badge>
                  <span className="text-mist-500">goes to review</span>
                </div>
              </div>
            </Bento>

            <Bento span="lg:col-span-2" icon={ClipboardCheck} title="A plan that is versioned">
              <p>
                Rate scope, data and control risk. The approved plan sets the sampling rate, and a
                changed plan is a new version, never an edit.
              </p>
            </Bento>

            <Bento span="lg:col-span-2" icon={ListChecks} title="Sampling that earns its shortcut">
              <p>
                Low-risk values can be accepted in one audited batch, but only after a deterministic
                sample has been reviewed clean. The share is disclosed in the report.
              </p>
            </Bento>

            <Bento span="lg:col-span-2" icon={MapPin} title="Site fieldwork">
              <p>
                Observations, photos and meter readings captured on site. Text capture queues
                offline and syncs. The observer cannot be the one who accepts it.
              </p>
              <p className="mt-4 inline-flex items-center gap-2 text-xs text-mist-500">
                <WifiOff aria-hidden className="size-3.5" />
                Works through patchy connectivity
                <Camera aria-hidden className="ml-2 size-3.5" />
                Photos online
              </p>
            </Bento>

            <Bento span="lg:col-span-2" icon={MessageSquare} title="Issues that close properly">
              <p>
                Suggested, open, responded, verified, closed. The entity answers through a
                single-use link with no account, and blocking issues cannot be closed by decree.
              </p>
            </Bento>

            <Bento span="lg:col-span-2" icon={ShieldCheck} title="Independent technical review">
              <p>
                A second verifier who did not draft or accept the findings reviews a fixed snapshot.
                If the numbers change, the approval goes stale and sign-off waits.
              </p>
            </Bento>

            <Bento span="lg:col-span-2" icon={FileArchive} title="A submission package">
              <p>
                A deterministic ZIP with the report, findings, accepted facts and an evidence
                manifest of SHA-256 hashes. It states its own limits instead of hiding them.
              </p>
            </Bento>

            <Bento span="lg:col-span-3" icon={Table2} title="Portfolio import and stages">
              <p>
                Bring an agency&apos;s registry in from CSV or XLSX with a dry run first, then track
                each ADEETIE engagement from EOI to measurement and verification.
              </p>
            </Bento>

            <Bento span="lg:col-span-3" icon={Activity} title="Savings and simple payback">
              <p>
                For ADEETIE, a baseline specific energy consumption, savings per measure and simple
                payback, computed from accepted values and nothing else. Financial ratios wait for
                the confirmed DPR format.
              </p>
            </Bento>
          </div>
        </div>
      </section>

      {/* Schemes */}
      <section id="schemes" className="scroll-mt-24 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            kicker="Schemes"
            title={
              <>
                Two schemes live. Two more <Accent>designed, not guessed.</Accent>
              </>
            }
            body="Sector methodology lives in packs, as data, and the engine never branches on sector. A scheme without checked content stays marked as such."
          />
          <div className="mt-12 grid gap-4 md:grid-cols-2">
            <SchemeCard
              name="CCTS"
              full="Carbon Credit Trading Scheme"
              packs={ccts.length}
              runnable={runnable(ccts)}
              points={[
                "Greenhouse-gas emissions intensity against the notified target",
                "Scope 1 and Scope 2 streams bound to accepted facts",
                "Planning, site fieldwork and technical review built in",
                "Clause-referenced reconciliation rules and findings",
              ]}
            />
            <SchemeCard
              name="ADEETIE"
              full="BEE scheme for energy efficiency in MSMEs"
              packs={adeetie.length}
              runnable={runnable(adeetie)}
              points={[
                "Energy audit, DPR and M&V as stages you can track",
                "Specific energy consumption baseline and savings gate",
                "Measures with savings and simple payback",
                "Eligibility checks for cluster, loan size and debt share",
              ]}
            />
          </div>
          <div className="mt-4 grid gap-4 md:grid-cols-2">
            <InDesign
              name="CBAM"
              body="Embedded-emissions verification for installations. The flow and data model are drawn; the calculation rules, default values and verification requirements wait for a primary source and a practitioner."
            />
            <InDesign
              name="Green hydrogen"
              body="Emission intensity per kilogram of hydrogen against a threshold. The boundary, renewable-matching rules and certificate format are still to be confirmed before anything is built on them."
            />
          </div>
        </div>
      </section>

      {/* Principles */}
      <section id="principles" className="scroll-mt-24 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <SectionHeading
            kicker="Principles"
            title={
              <>
                Built to be <Accent>checked</Accent>
              </>
            }
            body="Every result can be traced back to a source and a person. These are the rules the product will not bend."
          />
          <ul className="mt-12 grid gap-x-10 gap-y-10 sm:grid-cols-2 lg:grid-cols-3">
            {PRINCIPLES.map(({ icon: Icon, title, body }) => (
              <li key={title} className="reveal">
                <span className="glass flex size-10 items-center justify-center rounded-xl text-teal-800">
                  <Icon aria-hidden className="size-[18px]" />
                </span>
                <h3 className="mt-4 text-[17px] font-medium tracking-tight text-mist-950">{title}</h3>
                <p className="mt-1.5 text-[15px] leading-relaxed text-mist-600">{body}</p>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* Trust */}
      <section id="trust" className="scroll-mt-24 py-20">
        <div className="mx-auto max-w-6xl px-6">
          <div className="glass rounded-3xl p-8 sm:p-12">
            <div className="grid gap-12 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)]">
              <div>
                <p className="eyebrow text-teal-700">Trust and security</p>
                <h2 className="mt-3 text-3xl leading-[1.1] font-medium tracking-[-0.025em] text-mist-950 sm:text-4xl">
                  Your clients&apos; plant data is <Accent>not a demo asset.</Accent>
                </h2>
                <p className="mt-4 text-[15px] leading-relaxed text-mist-600">
                  Competing firms share this product, so isolation and an unalterable record are
                  designed in, not added later. Controls we have not built yet are tracked, not hidden.
                </p>
                <div className="mt-7 flex flex-wrap gap-x-6 gap-y-3 text-sm font-medium">
                  <Link
                    href="/security"
                    className="inline-flex items-center gap-1 text-teal-800 hover:text-teal-950"
                  >
                    Security overview
                    <ArrowUpRight aria-hidden className="size-4" />
                  </Link>
                  <Link
                    href="/privacy"
                    className="inline-flex items-center gap-1 text-teal-800 hover:text-teal-950"
                  >
                    Privacy notice
                    <ArrowUpRight aria-hidden className="size-4" />
                  </Link>
                </div>
              </div>
              <ul className="grid gap-4 sm:grid-cols-2">
                {TRUST.map(({ icon: Icon, title, body }) => (
                  <li key={title} className="rounded-2xl bg-white/65 p-5 ring-1 ring-mist-900/6">
                    <Icon aria-hidden className="size-5 text-teal-700" />
                    <h3 className="mt-4 text-[15px] font-medium text-mist-950">{title}</h3>
                    <p className="mt-1 text-sm leading-relaxed text-mist-600">{body}</p>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section id="faq" className="scroll-mt-24 py-20">
        <div className="mx-auto grid max-w-6xl gap-12 px-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
          <SectionHeading
            kicker="FAQ"
            title={
              <>
                Questions firms ask <Accent>first</Accent>
              </>
            }
          />
          <div className="glass divide-y divide-mist-900/6 rounded-2xl px-6">
            {FAQ.map((item) => (
              <details key={item.q} className="group py-5">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 text-[16px] font-medium text-mist-950 [&::-webkit-details-marker]:hidden">
                  {item.q}
                  <span
                    aria-hidden
                    className="flex size-6 shrink-0 items-center justify-center rounded-full bg-mist-900/5 text-base leading-none text-mist-600 transition-transform group-open:rotate-45"
                  >
                    +
                  </span>
                </summary>
                <p className="mt-3 max-w-2xl text-[15px] leading-relaxed text-mist-600">{item.a}</p>
              </details>
            ))}
          </div>
        </div>
      </section>

      {/* Demo */}
      <section id="demo" className="scroll-mt-24 px-3 py-20 sm:px-6">
        <div className="glass-ink mx-auto max-w-6xl rounded-3xl p-6 sm:p-12">
          <div className="grid gap-12 lg:grid-cols-[minmax(0,2fr)_minmax(0,3fr)]">
            <div className="text-white">
              <p className="eyebrow text-teal-300">Request a demo</p>
              <h2 className="mt-3 text-3xl leading-[1.1] font-medium tracking-[-0.025em] sm:text-4xl">
                See it on an engagement{" "}
                <em className="font-display text-[1.1em] font-normal text-teal-200">like yours.</em>
              </h2>
              <p className="mt-4 text-[15px] leading-relaxed text-mist-300">
                Tell us which scheme you work on. We will walk through one engagement from the plan
                to the signed package, with your questions in mind.
              </p>
              <div className="mt-8 border-t border-white/10 pt-6 text-sm text-mist-300">
                <p>Prefer to start straight away?</p>
                <Link
                  href="/signup"
                  className="mt-1.5 inline-flex items-center gap-1.5 font-medium text-white hover:text-teal-200"
                >
                  Create your firm&apos;s account
                  <ArrowRight className="size-4" />
                </Link>
              </div>
            </div>
            <DemoRequestForm />
          </div>
        </div>
      </section>
    </main>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

function Accent({ children }: { children: React.ReactNode }) {
  return (
    <em className="font-display text-[1.1em] font-normal tracking-[-0.01em] text-teal-800">
      {children}
    </em>
  );
}

function SectionHeading({
  kicker,
  title,
  body,
}: {
  kicker: string;
  title: React.ReactNode;
  body?: string;
}) {
  return (
    <div className="max-w-2xl">
      <p className="eyebrow text-teal-700">{kicker}</p>
      <h2 className="mt-3 text-3xl leading-[1.1] font-medium tracking-[-0.025em] text-mist-950 sm:text-4xl">
        {title}
      </h2>
      {body ? <p className="mt-4 text-[16px] leading-relaxed text-mist-600">{body}</p> : null}
    </div>
  );
}

function Fact({ value, label }: { value: string; label: string }) {
  return (
    <div className="bg-white/70 px-6 py-5">
      <dd className="text-3xl font-medium tracking-[-0.03em] text-mist-950 tabular">{value}</dd>
      <dt className="mt-1 text-[13px] leading-snug text-mist-600">{label}</dt>
    </div>
  );
}

function Bento({
  span,
  icon: Icon,
  title,
  children,
}: {
  span: string;
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <article className={cn("glass reveal flex flex-col rounded-2xl p-6 sm:p-7", span)}>
      <span className="flex size-9 items-center justify-center rounded-xl bg-teal-700/10 text-teal-800">
        <Icon aria-hidden className="size-[18px]" />
      </span>
      <h3 className="mt-5 text-[17px] font-medium tracking-tight text-mist-950">{title}</h3>
      <div className="mt-2 text-[15px] leading-relaxed text-mist-600">{children}</div>
    </article>
  );
}

function Chip({ label, source }: { label: string; source: string }) {
  return (
    <li className="rounded-xl bg-white/70 px-3.5 py-3 ring-1 ring-mist-900/6">
      <p className="text-[13px] font-medium text-mist-900">{label}</p>
      <p className="mt-0.5 truncate font-mono text-[11.5px] text-mist-500">{source}</p>
    </li>
  );
}

function SchemeCard({
  name,
  full,
  packs,
  runnable,
  points,
}: {
  name: string;
  full: string;
  packs: number;
  runnable: number;
  points: string[];
}) {
  return (
    <article className="glass reveal rounded-2xl p-7 sm:p-8">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-2xl font-medium tracking-[-0.02em] text-mist-950">{name}</h3>
          <p className="mt-0.5 text-sm text-mist-600">{full}</p>
        </div>
        <Badge tone="ink" dot>
          {runnable} of {packs} sector {packs === 1 ? "pack" : "packs"} runnable
        </Badge>
      </div>
      <ul className="mt-7 space-y-3">
        {points.map((p) => (
          <li key={p} className="flex gap-3 text-[15px] text-mist-700">
            <Check aria-hidden className="mt-1 size-4 shrink-0 text-teal-700" />
            {p}
          </li>
        ))}
      </ul>
    </article>
  );
}

function InDesign({ name, body }: { name: string; body: string }) {
  return (
    <article className="reveal rounded-2xl border border-dashed border-mist-900/15 bg-white/30 p-6 sm:p-7">
      <div className="flex flex-wrap items-center gap-3">
        <h3 className="text-lg font-medium tracking-tight text-mist-950">{name}</h3>
        <Badge tone="neutral">In design</Badge>
      </div>
      <p className="mt-2 text-[15px] leading-relaxed text-mist-600">{body}</p>
    </article>
  );
}

/** A static, synthetic illustration of one reviewed value. */
function EvidencePreview() {
  return (
    <figure aria-label="Illustration of a value traced to its source page" className="relative">
      <div className="glass rounded-2xl shadow-lg">
        <div className="flex items-center justify-between border-b border-mist-900/6 px-5 py-3.5">
          <span className="text-[13px] font-medium text-mist-900">Coal tax invoice</span>
          <span className="font-mono text-xs text-mist-500">page 1</span>
        </div>
        <div className="space-y-2 px-6 pt-6 pb-12 text-xs text-mist-600">
          <div className="h-2 w-2/5 rounded-full bg-mist-900/6" />
          <div className="h-2 w-3/5 rounded-full bg-mist-900/6" />
          <div className="mt-5 grid grid-cols-2 gap-y-3 border-t border-mist-900/6 pt-5">
            <span>Grade</span>
            <span className="text-right font-mono">G-10</span>
            <span className="rounded-md bg-amber-200/50 px-1 outline-2 outline-amber-400/80">
              Quantity dispatched
            </span>
            <span className="rounded-md bg-amber-200/50 px-1 text-right font-mono text-mist-900 outline-2 outline-amber-400/80">
              18,247 MT
            </span>
            <span>Gross calorific value</span>
            <span className="text-right font-mono">4,200 kcal/kg</span>
          </div>
        </div>
      </div>

      <div className="drift glass relative -mt-8 ml-8 rounded-2xl p-5 shadow-lg sm:ml-16">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-mono text-xs text-mist-600">fuel.coal.quantity</span>
          <Badge tone="ai">AI-proposed</Badge>
        </div>
        <p className="mt-2 text-2xl font-medium tracking-[-0.02em] text-mist-950 tabular">
          18,247 <span className="text-sm font-normal text-mist-500">t</span>
        </p>
        <p className="mt-1.5 border-l-2 border-teal-600/40 pl-3 text-xs text-mist-600">
          “Quantity dispatched 18,247 MT”
        </p>
        <div className="mt-4 flex items-center gap-2">
          <span className={cn(buttonVariants({ size: "sm" }), "pointer-events-none rounded-full")}>
            <Check />
            Accept
          </span>
          <span
            className={cn(
              buttonVariants({ size: "sm", variant: "secondary" }),
              "pointer-events-none rounded-full"
            )}
          >
            Correct
          </span>
        </div>
      </div>
      <figcaption className="eyebrow mt-5 text-center text-mist-500">
        Illustration with synthetic data
      </figcaption>
    </figure>
  );
}
