/**
 * ADEETIE Detailed Project Report.
 *
 * IMPORTANT — this is NOT the official BEE DPR template.
 *
 * The scheme requires the DPR to be submitted on BEE's own template, published at
 * https://adeetie.beeindia.gov.in/. This document carries the same substance
 * (baseline, measures, projected savings, cost, loan structure, subvention) in the
 * VerifyStack house layout, together with the reproducibility record that the
 * official template has no field for: engine versions, pack version, factor set
 * version, and the input hash of every calculation behind the numbers.
 *
 * Before filing, the section order and field names below must be reconciled
 * against the current official template. Until that is done, treat this as a
 * working paper that supports the filing, not the filing itself.
 */

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { SecResult } from "../calc/sec";
import type { EnterpriseCategory, SubventionResult } from "../packs/adeetie/scheme";
import { formatINR } from "../packs/adeetie/scheme";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#1c1917" },
  kicker: {
    fontSize: 8,
    letterSpacing: 1.5,
    color: "#78716c",
    textTransform: "uppercase",
  },
  h1: { fontSize: 16, marginTop: 6, marginBottom: 4 },
  h2: {
    fontSize: 11,
    marginTop: 16,
    marginBottom: 6,
    borderBottom: "1pt solid #d6d3d1",
    paddingBottom: 3,
  },
  row: { marginBottom: 4 },
  mono: { fontFamily: "Courier", fontSize: 8 },
  banner: {
    backgroundColor: "#fffbeb",
    padding: 8,
    marginBottom: 10,
    fontSize: 9,
  },
  notice: {
    backgroundColor: "#f5f5f4",
    padding: 8,
    marginBottom: 10,
    fontSize: 8,
    color: "#44403c",
  },
  tableRow: { flexDirection: "row", marginBottom: 3 },
  cellWide: { width: "44%", fontSize: 9 },
  cell: { width: "18%", fontSize: 9, textAlign: "right" },
  label: { color: "#78716c", fontSize: 8 },
  foot: { marginTop: 20, fontSize: 8, color: "#78716c" },
});

export interface DprMeasure {
  id: string;
  description: string;
  /** Projected annual energy saving, in the SEC reporting unit. */
  projectedAnnualSaving: number;
  savingUnit: string;
  capitalCostINR: number;
  /** Basis for the projection: a quotation, a vendor guarantee, an audit estimate. */
  basis: string;
}

export interface AdeetieDprData {
  enterpriseName: string;
  plantName?: string | null;
  sector: string;
  cluster: string;
  state: string;
  clusterIsNotified: boolean;
  clusterListVerified: boolean;
  category: EnterpriseCategory;
  udyamRegistrationNo?: string | null;

  baseline: SecResult;
  measures: DprMeasure[];
  projectedPostSec?: number;
  projectedSavingsPct?: number;
  minSavingsPct: number;

  projectCostINR: number;
  loanAmountINR: number;
  subvention: SubventionResult;

  packId: string;
  packVersion: string;
  secEngineVersion: string;
  factorSetVersion: string;
  draftMode: boolean;

  /** Named attestation. Absent until a human signs off. */
  attestation?: {
    name: string;
    role: string;
    /** ISO timestamp supplied by the caller. */
    at: string;
  } | null;
}

function pctText(v: number | undefined): string {
  return typeof v === "number" ? `${v.toFixed(2)}%` : "not computed";
}

export function AdeetieDprReportPdf(data: AdeetieDprData) {
  const unverifiedFactors = data.baseline.streams
    .flatMap((s) => s.factorsUsed)
    .filter((f) => !f.verified);
  const debtSharePct =
    data.projectCostINR > 0 ? (data.loanAmountINR / data.projectCostINR) * 100 : 0;

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.kicker}>VerifyStack · ADEETIE</Text>
        <Text style={styles.h1}>Detailed Project Report — working paper</Text>
        <Text style={styles.row}>
          {data.enterpriseName}
          {data.plantName ? ` · ${data.plantName}` : ""} · {data.sector}
        </Text>

        <View style={styles.notice}>
          <Text>
            THIS IS NOT THE OFFICIAL BEE DPR TEMPLATE. The ADEETIE scheme requires the
            DPR to be filed on BEE&apos;s published template
            (https://adeetie.beeindia.gov.in/). This document carries the same substance
            in the VerifyStack layout plus the reproducibility record. Reconcile the
            section order and field names against the current official template before
            filing.
          </Text>
        </View>

        {data.draftMode ? (
          <View style={styles.banner}>
            <Text>
              DRAFT MODE — unverified reference factors were used. Not a verification
              opinion. Do not file.
            </Text>
          </View>
        ) : null}

        <Text style={styles.h2}>1. Enterprise and eligibility</Text>
        <Text style={styles.row}>Enterprise category: {data.category}</Text>
        <Text style={styles.row}>
          Udyam Registration: {data.udyamRegistrationNo ?? "NOT RECORDED"}
        </Text>
        <Text style={styles.row}>
          Cluster: {data.cluster}, {data.state} —{" "}
          {data.clusterIsNotified
            ? "matched against the notified cluster list held by this system"
            : "NOT matched against the notified cluster list"}
        </Text>
        {data.clusterListVerified ? null : (
          <Text style={[styles.row, styles.label]}>
            The notified cluster list held by this system is UNVERIFIED against the
            official BEE publication. Confirm cluster eligibility against the published
            list before relying on it.
          </Text>
        )}

        <Text style={styles.h2}>2. Baseline specific energy consumption</Text>
        <Text style={styles.row}>
          Period: {data.baseline.periodLabel} · Output{" "}
          {data.baseline.production.value} {data.baseline.production.unit} (
          {data.baseline.productUnitLabel})
        </Text>
        <Text style={styles.row}>
          Baseline SEC: {data.baseline.sec} {data.baseline.secUnitLabel} · Total energy{" "}
          {data.baseline.totalEnergy.value} {data.baseline.totalEnergy.unit}
        </Text>

        <View style={styles.tableRow}>
          <Text style={[styles.cellWide, styles.label]}>Energy stream</Text>
          <Text style={[styles.cell, styles.label]}>
            {data.baseline.totalEnergy.unit}
          </Text>
          <Text style={[styles.cell, styles.label]}>Share</Text>
        </View>
        {data.baseline.streams.map((s) => (
          <View key={s.streamId} style={styles.tableRow}>
            <Text style={styles.cellWide}>{s.label}</Text>
            <Text style={styles.cell}>{s.energyReported.value}</Text>
            <Text style={styles.cell}>{s.sharePct.toFixed(2)}%</Text>
          </View>
        ))}

        {data.baseline.demand ? (
          <Text style={[styles.row, { marginTop: 6 }]}>
            Contracted demand {data.baseline.demand.contractedDemandKVA ?? "—"} kVA ·
            maximum demand {data.baseline.demand.maximumDemandKVA ?? "—"} kVA · demand
            utilisation {data.baseline.demand.demandUtilisationPct ?? "—"}%. Demand is
            apparent power and is excluded from the energy total above.
          </Text>
        ) : null}

        <Text style={styles.h2}>3. Proposed measures and projected savings</Text>
        {data.measures.length === 0 ? (
          <Text style={styles.row}>No measures recorded.</Text>
        ) : (
          <>
            <View style={styles.tableRow}>
              <Text style={[styles.cellWide, styles.label]}>Measure</Text>
              <Text style={[styles.cell, styles.label]}>Saving</Text>
              <Text style={[styles.cell, styles.label]}>Capital cost</Text>
            </View>
            {data.measures.map((m) => (
              <View key={m.id}>
                <View style={styles.tableRow}>
                  <Text style={styles.cellWide}>{m.description}</Text>
                  <Text style={styles.cell}>
                    {m.projectedAnnualSaving} {m.savingUnit}
                  </Text>
                  <Text style={styles.cell}>{formatINR(m.capitalCostINR)}</Text>
                </View>
                <Text style={[styles.label, { marginBottom: 4 }]}>
                  Basis: {m.basis}
                </Text>
              </View>
            ))}
          </>
        )}
        <Text style={[styles.row, { marginTop: 6 }]}>
          Projected post-implementation SEC:{" "}
          {data.projectedPostSec ?? "not computed"} {data.baseline.secUnitLabel} ·
          projected saving {pctText(data.projectedSavingsPct)} against a scheme minimum
          of {data.minSavingsPct}%.
        </Text>
        <Text style={styles.label}>
          Projected savings are estimates from the measures above. The scheme gate is
          decided on measured post-implementation performance at M&amp;V, not on this
          projection.
        </Text>

        <Text style={styles.h2}>4. Project cost, loan and interest subvention</Text>
        <Text style={styles.row}>
          Project cost {formatINR(data.projectCostINR)} · loan{" "}
          {formatINR(data.loanAmountINR)} · debt funding {debtSharePct.toFixed(2)}% of
          project cost
        </Text>
        <Text style={styles.row}>
          Interest subvention: headline {data.subvention.headlineSubventionPct}% for a{" "}
          {data.subvention.category} enterprise; applied{" "}
          {data.subvention.appliedSubventionPct}%; net borrowing rate{" "}
          {data.subvention.netBorrowingRatePct}%; indicative annual relief{" "}
          {formatINR(data.subvention.annualReliefINR)}.
        </Text>
        {data.subvention.notes.map((n, i) => (
          <Text key={i} style={styles.label}>
            {n}
          </Text>
        ))}
        <Text style={styles.label}>Clause: {data.subvention.clauseRef}</Text>

        <Text style={styles.h2}>5. Reproducibility record</Text>
        <Text style={styles.row}>
          Pack {data.packId} v{data.packVersion} · SEC engine {data.secEngineVersion} ·
          factor set {data.factorSetVersion}
        </Text>
        <Text style={styles.kicker}>Baseline input hash</Text>
        <Text style={styles.mono}>{data.baseline.inputsHash}</Text>
        {unverifiedFactors.length > 0 ? (
          <Text style={[styles.row, { marginTop: 6 }]}>
            UNVERIFIED reference factors used:{" "}
            {unverifiedFactors.map((f) => `${f.id} (${f.vintage})`).join(", ")}. Each
            must be cited against its published source before this report is relied on.
          </Text>
        ) : null}
        {data.baseline.warnings.map((w, i) => (
          <Text key={i} style={styles.label}>
            {w}
          </Text>
        ))}

        <Text style={styles.h2}>6. Attestation</Text>
        {data.attestation ? (
          <Text style={styles.row}>
            {data.attestation.name}, {data.attestation.role} — {data.attestation.at}
          </Text>
        ) : (
          <Text style={styles.row}>
            NOT ATTESTED. No named individual has signed off on this report.
          </Text>
        )}
        <Text style={styles.foot}>
          The Investment Grade Energy Audit underlying this report must be carried out by
          a BEE-empanelled Certified or Accredited Energy Auditor firm. This system does
          not verify empanelment. Named attestation is recorded separately in the audit
          log; this PDF is not an e-sign vendor artefact.
        </Text>
      </Page>
    </Document>
  );
}
