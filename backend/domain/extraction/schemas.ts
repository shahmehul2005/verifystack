/**
 * Extraction schemas.
 *
 * Two invariants enforced here, at the boundary, before anything reaches the database:
 *   1. Every extracted value carries provenance — document, page, bounding box.
 *      A value without provenance is rejected, which is what makes
 *      "click any number to see its source" an invariant rather than a feature.
 *   2. Every extracted value carries a confidence, and low-confidence values are
 *      routed to a human instead of being committed.
 */

import { z } from "zod";

/** Normalised bounding box on the page, origin top-left, values in [0,1]. */
export const BBoxSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0).max(1),
  height: z.number().min(0).max(1),
});
export type BBox = z.infer<typeof BBoxSchema>;

export const ProvenanceSchema = z.object({
  page: z.number().int().positive(),
  bbox: BBoxSchema,
  /** Verbatim text the model read. Lets a reviewer spot OCR drift instantly. */
  sourceText: z.string().min(1),
});
export type ExtractionProvenance = z.infer<typeof ProvenanceSchema>;

/** Wraps any extracted value with the evidence of where it came from. */
export function provenanced<T extends z.ZodTypeAny>(value: T) {
  return z.object({
    value,
    confidence: z.number().min(0).max(1),
    provenance: ProvenanceSchema,
  });
}

const PString = provenanced(z.string().min(1));
const PNumber = provenanced(z.number());
const PDate = provenanced(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected ISO date YYYY-MM-DD"));

/** A measured amount plus the unit exactly as printed on the document. */
const PMeasure = z.object({
  value: z.number(),
  /** Empty when the page prints a bare number (typical for GST rupee totals). */
  unitAsPrinted: z.string(),
  confidence: z.number().min(0).max(1),
  provenance: ProvenanceSchema,
});

export const DOC_TYPES = [
  "fuel_invoice",
  "tax_invoice",
  "electricity_bill",
  "lab_certificate",
  "production_log",
  "weighbridge_slip",
  "monitoring_plan",
  // CCTS sector evidence with no general extractor yet.
  "reductant_balance",
  "anode_consumption_log",
  "anode_effect_log",
  "lime_kiln_log",
  "ammonia_carbon_balance",
  "hydrogen_plant_log",
  // ADEETIE evidence.
  "fuel_consumption_record",
  "udyam_certificate",
  "loan_sanction_letter",
  "equipment_quotation",
  "commissioning_certificate",
  "gst_registration",
  "audited_financials",
  "calibration_certificate",
  "igea_report",
  "unknown",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const ClassificationSchema = z.object({
  docType: z.enum(DOC_TYPES),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(500),
});
export type Classification = z.infer<typeof ClassificationSchema>;

/**
 * Generic Indian GST / commercial invoice. Used when the page is clearly an
 * invoice but is not a fuel delivery note or a utility bill. Line items stay
 * as printed — they do not enter GEI/SEC unless a later binding maps them.
 */
export const TaxInvoiceLineSchema = z.object({
  description: PString.nullish(),
  hsnCode: PString.nullish(),
  quantity: PMeasure.nullish(),
  rate: PMeasure.nullish(),
  amount: PMeasure.nullish(),
});

export const TaxInvoiceSchema = z.object({
  supplierName: PString.nullish(),
  supplierGstin: PString.nullish(),
  buyerName: PString.nullish(),
  invoiceNumber: PString.nullish(),
  invoiceDate: PDate.nullish(),
  taxableValue: PMeasure.nullish(),
  cgstAmount: PMeasure.nullish(),
  sgstAmount: PMeasure.nullish(),
  grandTotal: PMeasure.nullish(),
  lines: z.array(TaxInvoiceLineSchema).max(20),
});
export type TaxInvoice = z.infer<typeof TaxInvoiceSchema>;

/**
 * Fuels an ADEETIE energy baseline or a CCTS multi-fuel invoice may draw on.
 * "other" exists so a plant with an unlisted fuel is recorded honestly rather
 * than mapped onto the nearest match.
 */
export const FUEL_KINDS = [
  "coal",
  "coke",
  "png",
  "lpg",
  "furnace_oil",
  "diesel",
  "biomass",
  "natural_gas",
  "petcoke",
  "lignite",
  "naphtha",
  "refinery_gas",
  "black_liquor",
  "other",
] as const;

/** @deprecated Use FUEL_KINDS. Kept so existing ADEETIE imports keep working. */
export const ADEETIE_FUEL_KINDS = FUEL_KINDS;

export type FuelKind = (typeof FUEL_KINDS)[number];

export const FuelInvoiceSchema = z.object({
  supplierName: PString,
  invoiceNumber: PString,
  invoiceDate: PDate,
  fuelDescription: PString,
  /** Grade as printed, e.g. "G-10". Left as a raw string; grade mapping is a separate step. */
  fuelGrade: PString.nullish(),
  quantity: PMeasure,
  /** Calorific value if the invoice states one. Often absent — that is normal, not an error. */
  calorificValue: PMeasure.nullish(),
  calorificBasis: provenanced(z.enum(["NCV", "GCV"])).nullish(),
  /**
   * Discrete fuel kind. When present, Process 3.4 prefixes quantity / CV paths
   * (`coke.quantity`) so a multi-fuel pack can bind without sector code.
   */
  fuelKind: provenanced(z.enum(FUEL_KINDS)).nullish(),
  deliveryPeriodStart: PDate.nullish(),
  deliveryPeriodEnd: PDate.nullish(),
});
export type FuelInvoice = z.infer<typeof FuelInvoiceSchema>;

export const ElectricityBillSchema = z.object({
  utilityName: PString,
  consumerNumber: PString,
  billingPeriodStart: PDate,
  billingPeriodEnd: PDate,
  /** Active energy consumed. Indian HT bills often label this "units". */
  activeEnergy: PMeasure,
  maximumDemand: PMeasure.nullish(),
  /** Present when the connection has on-site or open-access generation to separate out. */
  renewableEnergy: PMeasure.nullish(),
  /**
   * Sanctioned/contracted demand, printed in kVA on an Indian HT bill.
   *
   * Kept as a measure with the unit as printed so the unit registry can refuse to
   * treat it as energy. A large share of ADEETIE-eligible savings is demand-side,
   * so the field matters — it simply must never be summed into a consumption total.
   */
  contractedDemand: PMeasure.nullish(),
  /** Unit cost as billed, in rupees per unit. Drives the DPR savings valuation. */
  unitCostINRPerKWh: PNumber.nullish(),
});
export type ElectricityBill = z.infer<typeof ElectricityBillSchema>;

/**
 * Fuel consumption record for the ADEETIE baseline.
 *
 * Distinct from FuelInvoiceSchema: a small enterprise's fuel evidence is usually a
 * consumption register covering a period, not a single priced invoice, and the fuel
 * kind has to be captured discretely because it selects the energy content factor
 * and therefore the dimension (per kg or per SCM/litre) of the calorific value.
 */
export const FuelConsumptionRecordSchema = z.object({
  fuelKind: provenanced(z.enum(FUEL_KINDS)),
  /** Fuel description exactly as written, kept alongside the mapped kind. */
  fuelDescription: PString,
  supplierName: PString.nullish(),
  documentReference: PString.nullish(),
  periodStart: PDate,
  periodEnd: PDate,
  quantity: PMeasure,
  /** Calorific value where the record or an attached certificate states one. */
  calorificValue: PMeasure.nullish(),
  calorificBasis: provenanced(z.enum(["NCV", "GCV"])).nullish(),
});
export type FuelConsumptionRecord = z.infer<typeof FuelConsumptionRecordSchema>;

/**
 * Udyam Registration Certificate. Establishes MSME status and the enterprise
 * category, which together decide eligibility and the subvention rate.
 *
 * Extraction reads the certificate; it does not validate the registration against
 * the Udyam portal. Rule AD-ELG001 says so explicitly rather than implying the
 * number was checked.
 */
export const UdyamCertificateSchema = z.object({
  udyamRegistrationNumber: PString,
  enterpriseName: PString,
  /** Micro / Small / Medium as printed on the certificate. */
  enterpriseCategory: provenanced(z.enum(["Micro", "Small", "Medium"])),
  majorActivity: PString.nullish(),
  /** NIC code as printed. Mapping to an ADEETIE sector is a separate, human step. */
  nicCode: PString.nullish(),
  dateOfIncorporation: PDate.nullish(),
  dateOfUdyamRegistration: PDate.nullish(),
  state: PString.nullish(),
  district: PString.nullish(),
});
export type UdyamCertificate = z.infer<typeof UdyamCertificateSchema>;

export const LabCertificateSchema = z.object({
  certificateNumber: PString,
  labName: PString,
  nablAccreditationNo: PString.nullish(),
  nablValidUntil: PDate.nullish(),
  sampleId: PString.nullish(),
  sampleDate: PDate.nullish(),
  testDate: PDate,
  materialDescription: PString,
  calorificValue: PMeasure,
  calorificBasis: provenanced(z.enum(["NCV", "GCV"])),
  moisturePct: PNumber.nullish(),
  ashPct: PNumber.nullish(),
});
export type LabCertificate = z.infer<typeof LabCertificateSchema>;

export const ProductionLogSchema = z.object({
  productDescription: PString.nullish(),
  reportingPeriod: PString.nullish(),
  production: PMeasure,
});
export type ProductionLog = z.infer<typeof ProductionLogSchema>;

export const DOC_SCHEMAS = {
  fuel_invoice: FuelInvoiceSchema,
  tax_invoice: TaxInvoiceSchema,
  electricity_bill: ElectricityBillSchema,
  lab_certificate: LabCertificateSchema,
  fuel_consumption_record: FuelConsumptionRecordSchema,
  udyam_certificate: UdyamCertificateSchema,
  production_log: ProductionLogSchema,
} as const;

export type ExtractableDocType = keyof typeof DOC_SCHEMAS;

export function isExtractable(t: DocType): t is ExtractableDocType {
  return t in DOC_SCHEMAS;
}

/**
 * Confidence policy.
 *
 * Below `reviewBelow`, a field is never auto-committed — it goes to a human queue.
 * Fields listed as high-materiality are always reviewed regardless of confidence,
 * because a confident wrong number is more dangerous than an uncertain one.
 */
export const CONFIDENCE_POLICY = {
  reviewBelow: 0.9,
  alwaysReview: new Set<string>([
    "quantity",
    "activeEnergy",
    "calorificValue",
    "calorificBasis",
    // ADEETIE: these decide eligibility and the subvention rate outright, so a
    // confident wrong reading is worse than an uncertain one.
    "fuelKind",
    "udyamRegistrationNumber",
    "enterpriseCategory",
    "contractedDemand",
    "grandTotal",
    "taxableValue",
    "production",
  ]),
} as const;

export interface FieldDecision {
  fieldPath: string;
  confidence: number;
  action: "auto_commit" | "human_review";
  reason: string;
}

/** Walks an extracted payload and decides, per field, whether a human must look. */
export function triageFields(payload: unknown, prefix = ""): FieldDecision[] {
  const out: FieldDecision[] = [];
  if (payload === null || typeof payload !== "object") return out;
  if (Array.isArray(payload)) {
    payload.forEach((item, i) => {
      out.push(...triageFields(item, prefix ? `${prefix}.${i}` : String(i)));
    });
    return out;
  }

  for (const [key, raw] of Object.entries(payload as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (raw === null || typeof raw !== "object") continue;

    const node = raw as Record<string, unknown>;
    const hasConfidence = typeof node.confidence === "number";
    const hasProvenance = typeof node.provenance === "object" && node.provenance !== null;

    if (hasConfidence && hasProvenance) {
      const confidence = node.confidence as number;
      const mustReview = CONFIDENCE_POLICY.alwaysReview.has(key);
      if (mustReview) {
        out.push({
          fieldPath: path,
          confidence,
          action: "human_review",
          reason: "High-materiality field — always reviewed regardless of confidence",
        });
      } else if (confidence < CONFIDENCE_POLICY.reviewBelow) {
        out.push({
          fieldPath: path,
          confidence,
          action: "human_review",
          reason: `Confidence ${confidence.toFixed(2)} below threshold ${CONFIDENCE_POLICY.reviewBelow}`,
        });
      } else {
        out.push({
          fieldPath: path,
          confidence,
          action: "auto_commit",
          reason: "Confidence above threshold and not high-materiality",
        });
      }
    } else {
      out.push(...triageFields(node, path));
    }
  }
  return out;
}
