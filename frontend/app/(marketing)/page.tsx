import Link from "next/link";

export default function MarketingPage() {
  return (
    <div className="min-h-screen bg-stone-50 text-stone-900">
      <header className="border-b border-stone-800 bg-stone-900 px-6 py-5 text-stone-50">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4">
          <div>
            <p className="text-[11px] uppercase tracking-[0.2em] text-stone-400">
              For ACVAs and energy auditors
            </p>
            <h1 className="mt-1 text-xl font-semibold tracking-tight">VerifyStack</h1>
          </div>
          <div className="flex gap-3 text-sm">
            <Link href="/login" className="text-stone-300 hover:text-white">
              Sign in
            </Link>
            <Link href="/workbench" className="bg-white px-3 py-1.5 text-stone-900">
              Public demo
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl px-6 py-16">
        <p className="max-w-2xl text-lg leading-relaxed text-stone-800">
          Operational verification workbench for India&apos;s BEE schemes — CCTS and ADEETIE.
          Built for the verifier. Never sold to the audited entity.
        </p>
        <p className="mt-4 max-w-2xl text-sm leading-relaxed text-stone-600">
          Evidence with page-level provenance. A deterministic calculation engine. Reconciliation
          rules that observe, never conclude. CAR drafts that cannot invent numbers. Models
          propose; licensed verifiers decide.
        </p>

        <ul className="mt-10 grid gap-4 sm:grid-cols-2">
          {[
            ["Code computes", "The engine is versioned and hashed. Language models never perform arithmetic."],
            ["No value without provenance", "Document, page, bounding box, and verbatim source text — or the value is refused."],
            ["AI proposes, humans decide", "High-materiality fields always require a named reviewer. Nothing auto-approves them."],
            ["Reproducible runs", "Every calculation records engine version, pack version, and input hash."],
          ].map(([t, d]) => (
            <li key={t} className="border border-stone-200 bg-white p-4">
              <h2 className="text-sm font-semibold">{t}</h2>
              <p className="mt-1 text-sm text-stone-600">{d}</p>
            </li>
          ))}
        </ul>

        <p className="mt-10 text-xs text-stone-500">
          No performance claims. Factors in the demo are unverified placeholders until a human
          cites a published source. See{" "}
          <Link href="/privacy" className="underline">
            privacy / DPDP
          </Link>
          .
        </p>
      </main>
    </div>
  );
}
