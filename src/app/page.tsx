import Link from "next/link";

export default function Home() {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-200 bg-stone-900 px-6 py-4 text-stone-50">
        <p className="text-[11px] uppercase tracking-[0.2em] text-stone-400">
          BITSoM Vertex · prototype
        </p>
        <h1 className="mt-1 text-xl font-semibold tracking-tight">VerifyStack</h1>
        <p className="mt-1 max-w-xl text-sm text-stone-300">
          AI-assisted verification workbench for India&apos;s ACVAs and energy auditors.
          Models propose. Licensed verifiers decide.
        </p>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12">
        <p className="text-sm leading-relaxed text-stone-700">
          India&apos;s Carbon Credit Trading Scheme makes third-party verification of
          plant-level emission intensity legally mandatory. That work still runs on
          email and spreadsheets. This prototype is the verifier-native slice: evidence
          with page-level provenance, a deterministic calculation engine, reconciliation
          rules, and CAR drafts that cannot invent numbers.
        </p>

        <Link
          href="/workbench"
          className="mt-8 inline-flex rounded bg-stone-900 px-4 py-2.5 text-sm font-medium text-white"
        >
          Open the cement engagement demo
        </Link>

        <ul className="mt-10 space-y-3 text-sm text-stone-700">
          <li>
            <strong>Click any number</strong> — it jumps to the highlighted region on the
            source facsimile.
          </li>
          <li>
            <strong>Findings</strong> come from rules (stock balance, GCV vs NCV, NABL
            lapse, missing months, grid-factor vintage). AI only phrases CARs.
          </li>
          <li>
            <strong>Emission factors are placeholders</strong> and the engine stamps
            draft mode. This is not a filing pack.
          </li>
        </ul>
      </main>
    </div>
  );
}
