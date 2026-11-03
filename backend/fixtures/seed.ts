import { qty } from "@verifystack/backend/domain/units";
import type { CalcInput } from "@verifystack/backend/domain/calc/engine";
import type { ReconciliationContext } from "@verifystack/backend/domain/rules/types";
import type { DemoDocument, DemoFact } from "./types";

export const SEED_ENGAGEMENT = {
  id: "eng-rjk-cem-fy2526",
  client: "Aravalli Cement Works Ltd.",
  plant: "Beawar Line 2 (synthetic demo plant)",
  sector: "cement",
  mechanism: "CCTS Compliance Mechanism",
  complianceYear: "FY2025-26",
  acva: "Design partner ACVA (demo)",
  leadVerifier: "Pending assignment",
  geiTarget: 0.82,
} as const;

export const SEED_DOCUMENTS: DemoDocument[] = [
  {
    id: "doc-coal-inv",
    title: "SCCL coal invoice INV-1182",
    kind: "fuel_invoice",
    subtitle: "Grade G-10 · 18,247 MT · GCV printed",
    pages: 1,
  },
  {
    id: "doc-lab",
    title: "NABL lab certificate NABL-CEM-441",
    kind: "lab_certificate",
    subtitle: "Sample tested after accreditation lapse",
    pages: 1,
  },
  {
    id: "doc-elec",
    title: "Discom HT bill Oct 2025",
    kind: "electricity_bill",
    subtitle: "22,166.64 MWh active energy",
    pages: 1,
  },
  {
    id: "doc-prod",
    title: "Equivalent-product log FY2025-26",
    kind: "production_log",
    subtitle: "1,850,000 t cement equivalent",
    pages: 1,
  },
];

export const SEED_FACTS: DemoFact[] = [
  {
    id: "fact-coal-qty",
    documentId: "doc-coal-inv",
    field: "quantity",
    display: "18,247 MT",
    value: 18247,
    unit: "t",
    confidence: 0.97,
    state: "accepted",
    page: 1,
    bbox: { x: 0.58, y: 0.48, width: 0.28, height: 0.045 },
    sourceText: "18,247 MT",
  },
  {
    id: "fact-coal-gcv",
    documentId: "doc-coal-inv",
    field: "calorificValue",
    display: "4,200 kcal/kg (GCV)",
    value: 4200,
    unit: "kcal/kg",
    confidence: 0.94,
    state: "accepted",
    page: 1,
    bbox: { x: 0.52, y: 0.56, width: 0.34, height: 0.045 },
    sourceText: "GCV 4,200 kcal/kg",
  },
  {
    id: "fact-lab-ncv",
    documentId: "doc-lab",
    field: "calorificValue",
    display: "17.58 MJ/kg NCV",
    value: 17.58,
    unit: "MJ/kg",
    confidence: 0.96,
    state: "accepted",
    page: 1,
    bbox: { x: 0.5, y: 0.52, width: 0.32, height: 0.05 },
    sourceText: "NCV 17.58 MJ/kg",
  },
  {
    id: "fact-lab-nabl",
    documentId: "doc-lab",
    field: "nablValidUntil",
    display: "Valid until 31 May 2025",
    value: "2025-05-31",
    confidence: 0.99,
    state: "accepted",
    page: 1,
    bbox: { x: 0.12, y: 0.38, width: 0.55, height: 0.04 },
    sourceText: "NABL TC-8891 valid until 31-05-2025",
  },
  {
    id: "fact-lab-testdate",
    documentId: "doc-lab",
    field: "testDate",
    display: "Tested 15 Aug 2025",
    value: "2025-08-15",
    confidence: 0.98,
    state: "accepted",
    page: 1,
    bbox: { x: 0.12, y: 0.44, width: 0.42, height: 0.04 },
    sourceText: "Date of test: 15-08-2025",
  },
  {
    id: "fact-elec-kwh",
    documentId: "doc-elec",
    field: "activeEnergy",
    display: "22,166,640 kWh",
    value: 22166.64,
    unit: "MWh",
    confidence: 0.95,
    state: "accepted",
    page: 1,
    bbox: { x: 0.48, y: 0.5, width: 0.38, height: 0.05 },
    sourceText: "Active energy 22,166,640 Units",
  },
  {
    id: "fact-prod",
    documentId: "doc-prod",
    field: "production",
    display: "1,850,000 t eq.",
    value: 1_850_000,
    unit: "t",
    confidence: 0.93,
    state: "accepted",
    page: 1,
    bbox: { x: 0.5, y: 0.46, width: 0.36, height: 0.05 },
    sourceText: "Equivalent product 1,850,000 t",
  },
];

/** The four facts a Cement GEI run actually binds. Used by the draft seed-demo path. */
export const CEMENT_DEMO_RUN_FACTS = [
  {
    field_path: "quantity",
    value_json: 18247,
    unit: "t",
    source_text: "18,247 MT",
  },
  {
    field_path: "calorificValue",
    value_json: 4200,
    unit: "kcal/kg",
    source_text: "GCV 4,200 kcal/kg",
  },
  {
    field_path: "activeEnergy",
    value_json: 22166.64,
    unit: "MWh",
    source_text: "22,166.64 MWh",
  },
  {
    field_path: "production",
    value_json: 1_850_000,
    unit: "t",
    source_text: "1,850,000 t",
  },
] as const;

export function seedCalcInput(): CalcInput {
  return {
    engagementId: SEED_ENGAGEMENT.id,
    complianceYear: SEED_ENGAGEMENT.complianceYear,
    sector: "cement",
    allowUnverifiedFactors: true,
    geiTarget: SEED_ENGAGEMENT.geiTarget,
    streams: [
      {
        kind: "fuel_combustion",
        streamId: "coal-kiln",
        label: "Kiln coal (sub-bituminous, G-10)",
        emissionFactorId: "ef_coal_subbituminous",
        emissionFactorVintage: "IPCC2006",
        quantity: qty(18_247, "t"),
        calorificValue: qty(4200, "kcal/kg"),
        calorificBasis: "GCV",
        phase: "solid",
        provenance: {
          factIds: ["fact-coal-qty", "fact-coal-gcv"],
          label: "SCCL INV-1182 + GCV as printed",
        },
      },
      {
        kind: "electricity_import",
        streamId: "grid-ht",
        label: "Imported HT electricity",
        quantity: qty(22_166.64, "MWh"),
        gridFactorId: "cea_grid_ef",
        gridFactorVintage: "FY2024-25",
        provenance: {
          factIds: ["fact-elec-kwh"],
          label: "Discom HT bill Oct 2025",
        },
      },
    ],
    production: {
      quantity: qty(1_850_000, "t"),
      productUnitLabel: "tonne_cement",
      provenance: { factIds: ["fact-prod"], label: "Equivalent-product log" },
    },
  };
}

const FY_MONTHS = [
  "2025-04",
  "2025-05",
  "2025-06",
  "2025-07",
  "2025-08",
  "2025-09",
  "2025-10",
  "2025-11",
  "2025-12",
  "2026-01",
  "2026-02",
  "2026-03",
];

/** Demo-only. Production CCTS runs use `reconciliationContextFromFacts`. */
export function seedReconciliationContext(
  calc: ReconciliationContext["calc"]
): ReconciliationContext {
  return {
    complianceYear: SEED_ENGAGEMENT.complianceYear,
    expectedMonths: FY_MONTHS,
    calc,
    monthlySeries: {
      "coal-kiln": FY_MONTHS.slice(0, 10).map((month) => ({
        month,
        quantity: qty(1_500, "t"),
        factIds: ["fact-coal-qty"],
      })),
    },
    stockMovements: [
      {
        streamId: "coal-kiln",
        openingStock: qty(2_400, "t"),
        purchases: qty(18_247, "t"),
        closingStock: qty(1_800, "t"),
        reportedConsumption: qty(18_247, "t"),
        factIds: ["fact-coal-qty"],
      },
    ],
    labCertificates: [
      {
        certificateId: "NABL-CEM-441",
        labName: "Desert Analytics Pvt Ltd",
        nablAccreditationNo: "TC-8891",
        nablValidUntil: "2025-05-31",
        testDate: "2025-08-15",
        fuelKey: "coal_indian",
        calorificValue: qty(17.58, "MJ/kg"),
        calorificBasis: "NCV",
        factIds: ["fact-lab-ncv", "fact-lab-nabl", "fact-lab-testdate"],
      },
    ],
    samplingRecords: [
      {
        materialKind: "coal",
        month: "2025-10",
        samplesTaken: 1,
        throughput: qty(18_247, "t"),
        factIds: ["fact-coal-qty"],
      },
    ],
    gridFactorVintageUsed: "FY2024-25",
    materialityPct: 5,
    stockTolerancePct: 0.5,
  };
}

export const SEED_AI_ACTIONS = [
  {
    id: "ai-1",
    tool: "classify_document",
    model: "gemini-2.5-flash",
    promptVersion: "2026-08-22.1",
    ok: true,
    note: "INV-1182 → fuel_invoice (0.98)",
    humanDecision: "accepted" as const,
  },
  {
    id: "ai-2",
    tool: "extract_fields",
    model: "gemini-2.5-flash",
    promptVersion: "2026-08-22.1",
    ok: true,
    note: "Quantity, GCV, grade extracted with page/bbox provenance",
    humanDecision: "accepted" as const,
  },
  {
    id: "ai-3",
    tool: "explain_finding",
    model: "template",
    promptVersion: "car-template-1",
    ok: true,
    note: "CAR drafts filled only from rule outputs — no invented numbers",
    humanDecision: "pending" as const,
  },
];
