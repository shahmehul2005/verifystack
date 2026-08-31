/**
 * ADEETIE Monitoring & Verification report.
 *
 * IMPORTANT — this is NOT an official BEE M&V form.
 *
 * This is the document that decides money: the annual interest subvention release
 * depends on the minimum energy saving being achieved and sustained. So the layout
 * leads with the gate, states both SEC figures it was computed from, and prints
 * every reason the two figures may not be comparable — a saving produced by a
 * dropped stream or a changed output basis is not a saving.
 *
 * Reconcile against BEE's published M&V format (https://adeetie.beeindia.gov.in/)
 * before filing.
 */

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { SavingsAssessment, SecResult } from "../calc/sec";

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
  gateMet: { backgroundColor: "#f0fdf4", padding: 10, marginBottom: 10, fontSize: 11 },
  gateFailed: { backgroundColor: "#fef2f2", padding: 10, marginBottom: 10, fontSize: 11 },
  banner: { backgroundColor: "#fffbeb", padding: 8, marginBottom: 10, fontSize: 9 },
  notice: {
    backgroundColor: "#f5f5f4",
    padding: 8,
    marginBottom: 10,
    fontSize: 8,
    color: "#44403c",
  },
  tableRow: { flexDirection: "row", marginBottom: 3 },
  cellWide: { width: "40%", fontSize: 9 },
  cell: { width: "20%", fontSize: 9, textAlign: "right" },
  label: { color: "#78716c", fontSize: 8 },
  foot: { marginTop: 20, fontSize: 8, color: "#78716c" },
});

export interface AdeetieMvData {
  enterpriseName: string;
  plantName?: string | null;
  sector: string;
  cluster: string;

  baseline: SecResult;
  post: SecResult;
  savings: SavingsAssessment;

  /** ISO date the measures were commissioned, from the commissioning certificate. */
  commissionedOn?: string | null;
  /** Whether the saving has been demonstrated across more than one measurement period. */
  sustainedPeriodsObserved: number;

  packId: string;
  packVersion: string;
  secEngineVersion: string;
  factorSetVersion: string;
  draftMode: boolean;

  attestation?: {
    name: string;
    role: string;
    at: string;
  } | null;
}

export function AdeetieMvReportPdf(data: AdeetieMvData) {
  const s = data.savings;
  const comparable = s.comparabilityWarnings.length === 0;
  const gatePassable = s.meetsThreshold && comparable;

  const unverifiedFactors = [...data.baseline.streams, ...data.post.streams]
    .flatMap((x) => x.factorsUsed)
    .filter((f) => !f.verified);

  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.kicker}>VerifyStack · ADEETIE</Text>
        <Text style={styles.h1}>Monitoring &amp; Verification report — working paper</Text>
        <Text style={styles.row}>
          {data.enterpriseName}
          {data.plantName ? ` · ${data.plantName}` : ""} · {data.sector} · {data.cluster}
        </Text>

        <View style={styles.notice}>
          <Text>
            THIS IS NOT AN OFFICIAL BEE M&amp;V FORM. Reconcile against BEE&apos;s
            published M&amp;V format (https://adeetie.beeindia.gov.in/) before filing.
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

        <View style={gatePassable ? styles.gateMet : styles.gateFailed}>
          <Text>
            Measured saving {s.savingsPct.toFixed(2)}% against a scheme minimum of{" "}
            {s.thresholdPct}% — {s.meetsThreshold ? "THRESHOLD MET" : "THRESHOLD NOT MET"}
            {s.meetsThreshold && !comparable
              ? ", BUT THE TWO PERIODS ARE NOT COMPARABLE"
              : ""}
            .
          </Text>
          <Text style={{ fontSize: 8, marginTop: 4 }}>
            The scheme requires the minimum to be achieved AND sustained before an annual
            interest subvention release. Sustained performance is a matter of observed
            periods, recorded below; it is not established by this single comparison.
          </Text>
        </View>

        <Text style={styles.h2}>1. Specific energy consumption</Text>
        <View style={styles.tableRow}>
          <Text style={[styles.cellWide, styles.label]}>Period</Text>
          <Text style={[styles.cell, styles.label]}>Output</Text>
          <Text style={[styles.cell, styles.label]}>Energy</Text>
          <Text style={[styles.cell, styles.label]}>SEC</Text>
        </View>
        {[
          { tag: "Baseline", r: data.baseline },
          { tag: "Post-implementation", r: data.post },
        ].map(({ tag, r }) => (
          <View key={tag} style={styles.tableRow}>
            <Text style={styles.cellWide}>
              {tag} · {r.periodLabel}
            </Text>
            <Text style={styles.cell}>
              {r.production.value} {r.production.unit}
            </Text>
            <Text style={styles.cell}>
              {r.totalEnergy.value} {r.totalEnergy.unit}
            </Text>
            <Text style={styles.cell}>
              {r.sec} {r.secUnitLabel}
            </Text>
          </View>
        ))}
        <Text style={[styles.row, { marginTop: 6 }]}>
          Energy saved at post-implementation output: {s.energySavedAtPostOutput.value}{" "}
          {s.energySavedAtPostOutput.unit}.
        </Text>

        <Text style={styles.h2}>2. Comparability</Text>
        {comparable ? (
          <Text style={styles.row}>
            No comparability exception was detected: the two periods use the same output
            basis, the same reporting unit, the same factor set version, and the same set
            of energy streams.
          </Text>
        ) : (
          s.comparabilityWarnings.map((w, i) => (
            <Text key={i} style={styles.row}>
              • {w}
            </Text>
          ))
        )}

        <Text style={styles.h2}>3. Sustained performance</Text>
        <Text style={styles.row}>
          Commissioned on: {data.commissionedOn ?? "NOT RECORDED"}
        </Text>
        <Text style={styles.row}>
          Measurement periods observed at or above the threshold:{" "}
          {data.sustainedPeriodsObserved}.
        </Text>
        {data.sustainedPeriodsObserved < 2 ? (
          <Text style={styles.label}>
            Fewer than two measurement periods have been observed, so the saving is
            measured but not yet demonstrated as sustained.
          </Text>
        ) : null}

        <Text style={styles.h2}>4. Post-implementation energy streams</Text>
        {data.post.streams.map((x) => (
          <View key={x.streamId} style={styles.tableRow}>
            <Text style={styles.cellWide}>{x.label}</Text>
            <Text style={styles.cell}>{x.energyReported.value}</Text>
            <Text style={styles.cell}>{x.sharePct.toFixed(2)}%</Text>
          </View>
        ))}

        <Text style={styles.h2}>5. Reproducibility record</Text>
        <Text style={styles.row}>
          Pack {data.packId} v{data.packVersion} · SEC engine {data.secEngineVersion} ·
          factor set {data.factorSetVersion}
        </Text>
        <Text style={styles.kicker}>Baseline input hash</Text>
        <Text style={styles.mono}>{s.baselineInputHash}</Text>
        <Text style={styles.kicker}>Post-implementation input hash</Text>
        <Text style={styles.mono}>{s.postInputHash}</Text>
        {unverifiedFactors.length > 0 ? (
          <Text style={[styles.row, { marginTop: 6 }]}>
            UNVERIFIED reference factors used:{" "}
            {[...new Set(unverifiedFactors.map((f) => `${f.id} (${f.vintage})`))].join(
              ", "
            )}
            .
          </Text>
        ) : null}

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
          Named attestation is recorded separately in the audit log; this PDF is not an
          e-sign vendor artefact.
        </Text>
      </Page>
    </Document>
  );
}
