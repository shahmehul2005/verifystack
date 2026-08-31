"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { DemoPayload } from "@verifystack/backend/demo/types";
import { DocumentFacsimile } from "./DocumentFacsimile";

function fmtT(kg: number) {
  return (kg / 1000).toLocaleString("en-IN", { maximumFractionDigits: 1 });
}

export function Workbench() {
  const [data, setData] = useState<DemoPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [docId, setDocId] = useState("doc-coal-inv");
  const [focusFactId, setFocusFactId] = useState<string | null>("fact-coal-qty");
  const [tab, setTab] = useState<"numbers" | "findings" | "ai" | "live">("numbers");
  const [extractStatus, setExtractStatus] = useState<string>("");
  const [extractJson, setExtractJson] = useState<string>("");

  useEffect(() => {
    fetch("/api/demo")
      .then(async (r) => {
        if (!r.ok) throw new Error(`Demo API ${r.status}`);
        return r.json() as Promise<DemoPayload>;
      })
      .then((d) => {
        setData(d);
        setDocId(d.documents[0]?.id ?? "doc-coal-inv");
      })
      .catch((e: unknown) => setError(e instanceof Error ? e.message : "Failed to load"));
  }, []);

  const highlight = useMemo(() => {
    if (!data || !focusFactId) return null;
    return data.facts.find((f) => f.id === focusFactId) ?? null;
  }, [data, focusFactId]);

  const focusOnFacts = useCallback((factIds: string[]) => {
    const first = factIds[0];
    if (!first || !data) return;
    const fact = data.facts.find((f) => f.id === first);
    if (fact) {
      setDocId(fact.documentId);
      setFocusFactId(fact.id);
    }
  }, [data]);

  async function onUpload(file: File) {
    setExtractStatus("Reading file…");
    setExtractJson("");
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result));
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(file);
    });
    const b64 = dataUrl.replace(/^data:[^;]+;base64,/, "");
    const mimeType = file.type === "application/pdf"
      ? "application/pdf"
      : file.type === "image/png"
        ? "image/png"
        : "image/jpeg";
    setExtractStatus("Calling extract (classify → fields)…");
    const res = await fetch("/api/extract", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        evidenceId: `upload-${Date.now()}`,
        pageNumber: 1,
        mimeType,
        data: b64,
      }),
    });
    const json = await res.json();
    setExtractStatus(res.ok && json.ok ? "Done (human review still required)" : "Failed or unavailable");
    setExtractJson(JSON.stringify(json, null, 2));
  }

  if (error) {
    return <p className="p-8 text-sm text-red-700">{error}</p>;
  }
  if (!data) {
    return <p className="p-8 text-sm text-stone-500">Loading engagement…</p>;
  }

  const { engagement, calc, rules } = data;

  return (
    <div className="flex min-h-screen flex-col bg-stone-100 text-stone-900">
      <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-300 bg-stone-900 px-4 py-3 text-stone-50">
        <div>
          <p className="text-[11px] uppercase tracking-[0.18em] text-stone-400">
            VerifyStack · verifier workbench
          </p>
          <h1 className="text-sm font-semibold">
            {engagement.client} · {engagement.complianceYear}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2 text-[11px]">
          <span className="rounded border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-amber-200">
            Draft factors · not for filing
          </span>
          <span className="rounded border border-stone-600 px-2 py-1">
            Engine {calc.engineVersion}
          </span>
          <span className="rounded border border-stone-600 px-2 py-1">
            {rules.blocks} blocks · {rules.warns} warnings
          </span>
        </div>
      </header>

      <p className="border-b border-amber-200 bg-amber-50 px-4 py-2 text-[12px] text-amber-950">
        {data.disclaimer}
      </p>

      <div className="grid flex-1 lg:grid-cols-[minmax(280px,1fr)_minmax(340px,1.1fr)]">
        <section className="border-r border-stone-300 bg-stone-200/40 p-4">
          <p className="mb-2 text-[11px] font-medium uppercase tracking-wide text-stone-500">
            Evidence
          </p>
          <div className="mb-3 flex flex-wrap gap-1">
            {data.documents.map((d) => (
              <button
                key={d.id}
                type="button"
                onClick={() => {
                  setDocId(d.id);
                  const f = data.facts.find((x) => x.documentId === d.id);
                  setFocusFactId(f?.id ?? null);
                }}
                className={`rounded px-2 py-1 text-[11px] ${
                  docId === d.id
                    ? "bg-stone-900 text-white"
                    : "bg-white text-stone-700 ring-1 ring-stone-300"
                }`}
              >
                {d.title}
              </button>
            ))}
          </div>
          <DocumentFacsimile documentId={docId} highlight={highlight} />
          <p className="mt-2 text-[11px] text-stone-600">
            Click any figure on the right. The source region on this page is highlighted.
          </p>
        </section>

        <section className="flex min-h-0 flex-col bg-white">
          <div className="flex gap-1 border-b border-stone-200 px-3 pt-3">
            {(
              [
                ["numbers", "Traceable numbers"],
                ["findings", "Findings / CARs"],
                ["ai", "AI action log"],
                ["live", "Live extract"],
              ] as const
            ).map(([id, label]) => (
              <button
                key={id}
                type="button"
                onClick={() => setTab(id)}
                className={`rounded-t px-3 py-2 text-[12px] ${
                  tab === id
                    ? "bg-stone-100 font-medium text-stone-900"
                    : "text-stone-500"
                }`}
              >
                {label}
              </button>
            ))}
          </div>

          <div className="min-h-0 flex-1 overflow-auto p-4">
            {tab === "numbers" ? (
              <div className="space-y-3">
                <div className="grid gap-2 sm:grid-cols-3">
                  <Stat label="Scope 1" value={`${fmtT(calc.scope1.value)} tCO₂e`} />
                  <Stat label="Scope 2" value={`${fmtT(calc.scope2.value)} tCO₂e`} />
                  <Stat label="GEI" value={calc.gei.toFixed(4)} hint="tCO₂e / t cement" />
                </div>
                <p className="text-[12px] text-stone-500">
                  Hash {calc.inputsHash.slice(0, 16)}… · factor set {calc.factorSetVersion}
                </p>
                <ul className="divide-y divide-stone-100 border border-stone-200">
                  {data.traceables.map((t) => (
                    <li key={t.id}>
                      <button
                        type="button"
                        onClick={() => focusOnFacts(t.factIds)}
                        className="flex w-full flex-col items-start gap-1 px-3 py-2.5 text-left hover:bg-stone-50"
                      >
                        <span className="flex w-full justify-between gap-3 text-[13px]">
                          <span className="text-stone-600">
                            {t.scope ? `S${t.scope} · ` : ""}
                            {t.label}
                          </span>
                          <span className="font-mono text-stone-900">{t.value}</span>
                        </span>
                        {t.derivation ? (
                          <span className="font-mono text-[10px] text-stone-500">
                            {t.derivation}
                          </span>
                        ) : null}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {tab === "findings" ? (
              <ul className="space-y-3">
                {data.cars.map((car) => {
                  const finding = rules.findings.find((f) => f.ruleId === car.findingId);
                  return (
                    <li
                      key={car.heading + car.body.slice(0, 24)}
                      className="border border-stone-200 p-3"
                    >
                      <div className="flex items-center gap-2">
                        <span
                          className={`text-[10px] uppercase ${
                            finding?.severity === "block"
                              ? "text-red-700"
                              : "text-amber-800"
                          }`}
                        >
                          {finding?.severity} · {car.generator} · {car.state}
                        </span>
                      </div>
                      <h3 className="mt-1 text-[13px] font-medium">{car.heading}</h3>
                      <p className="mt-2 text-[12px] leading-relaxed text-stone-700">
                        {car.body}
                      </p>
                      <p className="mt-2 text-[11px] text-stone-500">{car.clauseRef}</p>
                      <button
                        type="button"
                        className="mt-2 text-[11px] underline"
                        onClick={() => focusOnFacts(car.evidenceRefs)}
                      >
                        Show evidence
                      </button>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            {tab === "ai" ? (
              <div>
                <p className="mb-3 text-[12px] text-stone-600">
                  Every model call is logged with tool, model, prompt version, and a human
                  decision. Exportable as accreditation evidence — AI never signs.
                </p>
                <table className="w-full text-left text-[12px]">
                  <thead>
                    <tr className="border-b text-stone-500">
                      <th className="py-1 font-medium">Tool</th>
                      <th className="font-medium">Model</th>
                      <th className="font-medium">Decision</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.aiActions.map((a) => (
                      <tr key={a.id} className="border-b border-stone-100">
                        <td className="py-2 font-mono">{a.tool}</td>
                        <td>{a.model}</td>
                        <td>{a.humanDecision}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : null}

            {tab === "live" ? (
              <div className="space-y-3 text-[12px]">
                <p className="text-stone-600">
                  Optional: drop a real invoice/bill (PNG, JPEG, or PDF). Requires{" "}
                  <code className="font-mono">GEMINI_API_KEY</code> in{" "}
                  <code className="font-mono">.env.local</code>. Output is a proposal only.
                </p>
                <input
                  type="file"
                  accept="image/png,image/jpeg,application/pdf"
                  onChange={(e) => {
                    const f = e.target.files?.[0];
                    if (f) void onUpload(f);
                  }}
                />
                <p className="text-stone-500">{extractStatus}</p>
                {extractJson ? (
                  <pre className="max-h-80 overflow-auto bg-stone-50 p-2 font-mono text-[10px]">
                    {extractJson}
                  </pre>
                ) : null}
              </div>
            ) : null}
          </div>
        </section>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="border border-stone-200 p-3">
      <p className="text-[11px] uppercase tracking-wide text-stone-500">{label}</p>
      <p className="font-mono text-lg">{value}</p>
      {hint ? <p className="text-[10px] text-stone-500">{hint}</p> : null}
    </div>
  );
}
