import { Document, Page, Text, View, StyleSheet } from "@react-pdf/renderer";

const styles = StyleSheet.create({
  page: { padding: 36, fontSize: 10, fontFamily: "Helvetica", color: "#1c1917" },
  kicker: { fontSize: 8, letterSpacing: 1.5, color: "#78716c", textTransform: "uppercase" },
  h1: { fontSize: 16, marginTop: 6, marginBottom: 12 },
  row: { marginBottom: 6 },
  mono: { fontFamily: "Courier", fontSize: 8 },
  banner: { backgroundColor: "#fffbeb", padding: 8, marginBottom: 12, fontSize: 9 },
});

export function VerificationReportPdf({
  clientName,
  plantName,
  complianceYear,
  packId,
  packVersion,
  engineVersion,
  inputHash,
  draftMode,
  gei,
}: {
  clientName: string;
  plantName?: string | null;
  complianceYear: string;
  packId: string;
  packVersion: string;
  engineVersion: string;
  inputHash: string;
  draftMode: boolean;
  gei?: number;
}) {
  return (
    <Document>
      <Page size="A4" style={styles.page}>
        <Text style={styles.kicker}>VerifyStack · verification workbench</Text>
        <Text style={styles.h1}>{clientName}</Text>
        <Text style={styles.row}>{plantName} · {complianceYear}</Text>
        {draftMode ? (
          <View style={styles.banner}>
            <Text>DRAFT MODE — unverified factors. Not a verification opinion. Do not file.</Text>
          </View>
        ) : null}
        <Text style={styles.row}>Pack {packId} v{packVersion}</Text>
        <Text style={styles.row}>Engine {engineVersion}</Text>
        {typeof gei === "number" ? <Text style={styles.row}>GEI {gei}</Text> : null}
        <Text style={styles.kicker}>Input hash</Text>
        <Text style={styles.mono}>{inputHash}</Text>
        <Text style={{ marginTop: 24, fontSize: 8, color: "#78716c" }}>
          Named attestation is recorded separately. This PDF is not an e-sign vendor artefact.
        </Text>
      </Page>
    </Document>
  );
}
