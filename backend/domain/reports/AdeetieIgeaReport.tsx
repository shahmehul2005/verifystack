/**
 * ADEETIE Investment Grade Energy Audit working paper.
 *
 * Not an official BEE IGEA template. Carries the baseline SEC and the measures
 * the audit identified, with the reproducibility record.
 */

import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";
import type { SecResult } from "../calc/sec";
import type { DprMeasure } from "./AdeetieDprReport";

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
  cellWide: { width: "50%", fontSize: 9 },
  cell: { width: "25%", fontSize: 9, textAlign: "right" },
  label: { color: "#78716c", fontSize: 8 },
  foot: { marginTop: 20, fontSize: 8, color: "#78716c" },
});

export interface AdeetieIgeaData {
  enterpriseName: string;
  plantName?: string | null;
  sector: string;
  cluster: string;
  baseline: SecResult;
  measures: DprMeasure[];
  packId: string;
  packVersion: string;
  secEngineVersion: string;
  factorSetVersion: string;
  draftMode: boolean;
  attestation?: { name: string; role: string; at: string } | null;
}

export function AdeetieIgeaReportPdf(data: AdeetieIgeaData) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.kicker}>VerifyStack · ADEETIE</Text>
        <Text style={styles.h1}>Investment Grade Energy Audit — working paper</Text>
        <Text style={styles.row}>
          {data.enterpriseName}
          {data.plantName ? ` · ${data.plantName}` : ""} · {data.sector}
          {data.cluster ? ` · ${data.cluster}` : ""}
        </Text>
        <View style={styles.notice}>
          <Text>
            THIS IS NOT AN OFFICIAL BEE IGEA TEMPLATE. It is the verifier workpaper for
            the IGEA pass: baseline SEC, stream derivations, and identified measures.
            Filing uses BEE&apos;s published format.
          </Text>
        </View>
        {data.draftMode ? (
          <View style={styles.banner}>
            <Text>DRAFT MODE — unverified energy-content factors. Do not file.</Text>
          </View>
        ) : null}

        <Text style={styles.h2}>1. Baseline specific energy consumption</Text>
        <Text style={styles.row}>
          Period: {data.baseline.periodLabel} · SEC {data.baseline.sec}{" "}
          {data.baseline.secUnitLabel} · Total energy {data.baseline.totalEnergy.value}{" "}
          {data.baseline.totalEnergy.unit}
        </Text>
        <Text style={styles.row}>
          Output {data.baseline.production.value} {data.baseline.production.unit} (
          {data.baseline.productUnitLabel})
        </Text>
        {data.baseline.streams.map((s) => (
          <View key={s.streamId} style={styles.tableRow}>
            <Text style={styles.cellWide}>{s.label}</Text>
            <Text style={styles.cell}>
              {s.energyReported.value} {s.energyReported.unit}
            </Text>
            <Text style={styles.cell}>{s.sharePct.toFixed(2)}%</Text>
          </View>
        ))}

        <Text style={styles.h2}>2. Identified energy conservation measures</Text>
        {data.measures.length === 0 ? (
          <Text style={styles.row}>No measures recorded in this pass.</Text>
        ) : (
          data.measures.map((m) => (
            <Text key={m.id} style={styles.row}>
              {m.description} — projected {m.projectedAnnualSaving} {m.savingUnit}/year ·
              capex {m.capitalCostINR} INR · basis {m.basis}
            </Text>
          ))
        )}

        <Text style={styles.h2}>3. Reproducibility</Text>
        <Text style={styles.mono}>
          pack {data.packId}@{data.packVersion} · sec-engine {data.secEngineVersion} ·
          factors {data.factorSetVersion} · input {data.baseline.inputsHash}
        </Text>
        {data.attestation ? (
          <Text style={styles.row}>
            Attested {data.attestation.role}: {data.attestation.name} at {data.attestation.at}
          </Text>
        ) : (
          <Text style={styles.row}>No named attestation on this pass yet.</Text>
        )}
        <Text style={styles.foot}>
          Energy-balance completeness and meter calibration are evaluated as findings,
          not as numbers invented for this page.
        </Text>
      </Page>
    </Document>
  );
}
