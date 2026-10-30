import type { ReactNode } from "react";

/*
 * Fragments of the product's own interface, built in HTML at true size for the
 * public site. Every name and figure is synthetic and consistent across
 * fragments: one engagement, one coal invoice, one reviewer. The root of each
 * carries `data-ui`, so the product's own conventions (quiet borders, small
 * labels) apply inside it.
 */

export function Sheet({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <div data-ui className="w-full bg-white text-[14px] leading-snug text-mist-800">
      <div className="flex items-baseline justify-between gap-4 border-b border-mist-900/10 px-5 py-3">
        <span className="font-medium text-mist-900">{title}</span>
        {meta ? <span className="text-right text-mist-500">{meta}</span> : null}
      </div>
      {children}
    </div>
  );
}

interface Row {
  k: string;
  v: ReactNode;
}

/** One label and its value. Built by a call, so a list of rows needs no keys. */
export const row = (k: string, v: ReactNode): Row => ({ k, v });

export function Rows({ rows }: { rows: Row[] }) {
  return (
    <dl className="divide-y divide-mist-900/8 px-5">
      {rows.map(({ k, v }) => (
        <div key={k} className="grid gap-x-4 gap-y-0.5 py-2.5 sm:grid-cols-[minmax(0,10rem)_1fr]">
          <dt className="text-mist-600">{k}</dt>
          <dd className="text-mist-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="border-t border-mist-900/10 bg-mist-50 px-5 py-3 text-mist-700">{children}</p>;
}

type Tone = "ok" | "warn" | "ai" | "block" | "plain";

const TONES: Record<Tone, string> = {
  ok: "bg-green-100 text-green-800",
  warn: "bg-amber-100 text-amber-800",
  ai: "bg-violet-100 text-violet-800",
  block: "bg-red-100 text-red-800",
  plain: "bg-mist-200 text-mist-700",
};

export function Tag({ tone = "plain", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={`inline-block px-2 py-0.5 text-[14px] font-medium ${TONES[tone]}`}>{children}</span>;
}

const HASH_RUN = "9d41…e07";

/* ------------------------------------------------------------------ */
/* How it works: one engagement, six states                             */
/* ------------------------------------------------------------------ */

export const STAGES = ["Plan", "Collect", "Review", "Calculate", "Resolve", "Sign"] as const;

export function EngagementFragment({ step }: { step: number }) {
  return (
    <Sheet title="Rajkot Cement Works" meta="CCTS cement · FY2025-26">
      <ol className="flex flex-wrap gap-1.5 px-5 pt-3 pb-2" aria-label="Stages">
        {STAGES.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? "step" : undefined}
            className={`px-2.5 py-1 text-[14px] font-medium ${
              i === step ? "bg-teal-600 text-white" : i < step ? "bg-teal-100 text-teal-800" : "bg-mist-100 text-mist-600"
            }`}
          >
            {s}
          </li>
        ))}
      </ol>
      <div className="min-h-72">{BODIES[step]}</div>
    </Sheet>
  );
}

const BODIES: ReactNode[] = [
  <>
    <p className="px-5 pt-3 pb-1 font-medium text-mist-900">Verification plan, version 2</p>
    <Rows
      rows={[
        row("Scope risk", <>Medium. Two kilns, one captive power plant</>),
        row("Data risk", <>High. Coal stock kept in a manual register</>),
        row("Control risk", <>Low. Production confirmed in SAP</>),
        row("Review sampling", <>25% of low-risk values</>),
        row("Site visit", <>Planned, one visit</>),
      ]}
    />
    <Note>Approved by the lead verifier. It replaces version 1, which is kept.</Note>
  </>,
  <>
    <p className="px-5 pt-3 pb-1 font-medium text-mist-900">Evidence received</p>
    <Rows
      rows={[
        row("Coal tax invoice", <>PDF, 2 pages <Tag tone="ai">values proposed</Tag></>),
        row("Production report", <>XLSX, 12 sheets mapped</>),
        row("Kiln SCADA export", <>CSV, 720 rows, 1 to 30 Apr</>),
        row("Site visit 1", <>6 photos, 3 meter readings</>),
      ]}
    />
    <Note>Each file is hashed on arrival, and its type is read from the bytes.</Note>
  </>,
  <>
    <p className="px-5 pt-3 pb-1 font-medium text-mist-900">Declared against evidence</p>
    <Rows
      rows={[
        row("Coal quantity", <>Declared 18,247 t · extracted 18,724 t <Tag tone="warn">Mismatch 2.6%</Tag></>),
        row("Calorific value", <>Declared 4,200 · extracted 4,200 <Tag tone="ok">Agrees</Tag></>),
        row("Total moisture", <>Declared 11.4% · extracted 11.4% <Tag tone="ok">Agrees</Tag></>),
      ]}
    />
    <Note>The gap is shown and measured against a tolerance. It goes to a person, never to the calculation.</Note>
  </>,
  <>
    <p className="px-5 pt-3 pb-1 font-medium text-mist-900">Run 7, computed from accepted facts</p>
    <Rows
      rows={[
        row("Engine and pack", <>0.1.0 · CCTS-CEMENT-v1</>),
        row("Inputs hash", <span className="font-mono">{HASH_RUN}</span>),
        row("Previous run", <span className="font-mono">5b2c…a90</span>),
        row("Kiln coal", <>18,247 t · accepted by A. Rao</>),
        row("Result", <>0.812 tCO2e per tonne of equivalent product</>),
      ]}
    />
    <Note>Code does the arithmetic. A model proposes values, and never produces a number.</Note>
  </>,
  <>
    <p className="px-5 pt-3 pb-1 font-medium text-mist-900">Finding MB001</p>
    <Rows
      rows={[
        row("Says", <>Fuel stock movement does not reconcile with reported consumption</>),
        row("Severity", <Tag tone="block">Blocks sign-off</Tag>),
        row("State", <>Responded. Next: the verifier checks the answer</>),
        row("Entity answer", <>Stock register page 14 corrected, revised file attached</>),
      ]}
    />
    <Note>The entity answered through a single-use link, with no account and no view of anything else.</Note>
  </>,
  <>
    <p className="px-5 pt-3 pb-1 font-medium text-mist-900">Sign-off</p>
    <Rows
      rows={[
        row("Technical review", <>Approved by S. Iyer, who did not draft or accept the findings</>),
        row("Verifier", <>A. Rao · signed</>),
        row("Independent reviewer", <>S. Iyer · signed</>),
        row("Package", <>submission.zip · 41 files · SHA-256 manifest</>),
      ]}
    />
    <Note>Two named people sign. Neither can be the one who observed or drafted.</Note>
  </>,
];

/* ------------------------------------------------------------------ */
/* Outputs: five documents the product produces                          */
/* ------------------------------------------------------------------ */

export const OUTPUTS = [
  {
    id: "plan",
    name: "Verification plan",
    claim: "Rate scope, data and control risk. The approved plan sets the sampling rate, and a changed plan is a new version, never an edit.",
  },
  {
    id: "run",
    name: "Calculation run",
    claim: "A versioned, hashed engine computes from accepted facts only. Every run records its engine, its pack and a hash of its inputs, chained to the one before.",
  },
  {
    id: "finding",
    name: "Finding and response",
    claim: "Suggested, open, responded, verified, closed. The entity answers through a single-use link, and blocking issues cannot be closed by decree.",
  },
  {
    id: "review",
    name: "Technical review",
    claim: "A second verifier who did not draft or accept the findings reviews a fixed snapshot. If the numbers change, the approval goes stale and sign-off waits.",
  },
  {
    id: "package",
    name: "Submission package",
    claim: "A deterministic ZIP with the report, findings, accepted facts and an evidence manifest of SHA-256 hashes. It states its own limits instead of hiding them.",
  },
] as const;

export type OutputId = (typeof OUTPUTS)[number]["id"];

export function OutputSheet({ id }: { id: OutputId }) {
  switch (id) {
    case "plan":
      return (
        <Sheet title="Verification plan" meta="Version 3 · approved">
          <table className="w-full text-left">
            <thead className="bg-mist-50 text-mist-600">
              <tr>
                <th className="px-5 py-2 font-medium">Risk factor</th>
                <th className="py-2 pr-3 font-medium">Rating</th>
                <th className="py-2 pr-5 font-medium">Why</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-mist-900/8">
              {[
                ["Scope", "Medium", "Two kilns and a captive plant"],
                ["Data", "High", "Coal stock in a manual register"],
                ["Control", "Low", "Production confirmed in SAP"],
              ].map(([a, b, c]) => (
                <tr key={a}>
                  <td className="px-5 py-2.5 text-mist-900">{a}</td>
                  <td className="py-2.5 pr-3">
                    <Tag tone={b === "High" ? "warn" : "plain"}>{b}</Tag>
                  </td>
                  <td className="py-2.5 pr-5 text-mist-700">{c}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <Rows
            rows={[
              row("Overall risk", <>High, the highest single factor</>),
              row("Review sampling", <>50% of low-risk values</>),
              row("Site visit", <>Planned, two visits</>),
            ]}
          />
          <Note>Version 3 replaces version 2 after a change in data risk. Version 2 is kept.</Note>
        </Sheet>
      );
    case "run":
      return (
        <Sheet title="Calculation run 7" meta="CCTS-CEMENT-v1 · engine 0.1.0">
          <Rows
            rows={[
              row("Inputs hash", <span className="font-mono">{HASH_RUN}</span>),
              row("Chained to run 6", <span className="font-mono">5b2c…a90</span>),
              row("Kiln coal", <>18,247 t · fact f_3a91c0 · accepted by A. Rao</>),
              row("HT electricity", <>4.12 GWh · fact f_77e2b4 · accepted by A. Rao</>),
              row("Clinker calcination", <>Required. No fact, no run</>),
              row("Production", <>1,850,000 t equivalent product</>),
            ]}
          />
          <Note>Result: 0.812 tCO2e per tonne of equivalent product, from accepted facts only.</Note>
        </Sheet>
      );
    case "finding":
      return (
        <Sheet title="Finding MB001" meta="Block · responded">
          <Rows
            rows={[
              row("Says", <>Fuel stock movement does not reconcile with reported consumption</>),
              row("Measured", <>Opening 12,400 t + purchases 18,900 t − closing 11,050 t = 20,250 t. Reported 19,800 t</>),
              row("Gap", <>450 t, 2.2% of consumption</>),
              row("Entity answer", <>Stock register page 14 corrected. Revised file attached</>),
            ]}
          />
          <ol className="flex flex-wrap gap-1.5 px-5 py-3" aria-label="State">
            {["Suggested", "Open", "Responded", "Verified", "Closed"].map((s, i) => (
              <li key={s} aria-current={i === 2 ? "step" : undefined} className={`px-2.5 py-1 text-[14px] font-medium ${i === 2 ? "bg-teal-600 text-white" : i < 2 ? "bg-teal-100 text-teal-800" : "bg-mist-100 text-mist-600"}`}>
                {s}
              </li>
            ))}
          </ol>
          <Note>A blocking issue is answered, verified and then closed. It cannot be closed from a draft.</Note>
        </Sheet>
      );
    case "review":
      return (
        <Sheet title="Independent technical review" meta="Snapshot 71c0…2fd">
          <Rows
            rows={[
              row("Reviewer", <>S. Iyer. Did not draft or accept any of the work</>),
              row("Reviewed", <>Facts, run 7 and 4 findings, as fixed at the snapshot</>),
              row("Decision", <Tag tone="ok">Approved</Tag>),
              row("Freshness", <>Current. A changed number makes it stale</>),
              row("Sign-offs", <>A. Rao, verifier · S. Iyer, independent reviewer</>),
            ]}
          />
          <Note>Both attestations are kept. The reviewer still signs separately.</Note>
        </Sheet>
      );
    case "package":
      return (
        <Sheet title="submission.zip" meta="41 files · deterministic">
          <Rows
            rows={[
              row("report.json", <>Verification report, run 7</>),
              row("findings.json", <>4 findings, 3 closed, 1 noted for the report</>),
              row("facts.json", <>212 accepted facts, each with its source</>),
              row("manifest.json", <>SHA-256 of every evidence file</>),
              row("LIMITS.txt", <>The layout is generic. The regulator&apos;s portal format is not yet confirmed</>),
            ]}
          />
          <Note>The same inputs always produce the same bytes, so a reviewer can rebuild it and compare.</Note>
        </Sheet>
      );
  }
}
