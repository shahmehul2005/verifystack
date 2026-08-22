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
  unitAsPrinted: z.string().min(1),
  confidence: z.number().min(0).max(1),
  provenance: ProvenanceSchema,
});

export const DOC_TYPES = [
  "fuel_invoice",
  "electricity_bill",
  "lab_certificate",
  "production_log",
  "weighbridge_slip",
  "monitoring_plan",
  "unknown",
] as const;
export type DocType = (typeof DOC_TYPES)[number];

export const ClassificationSchema = z.object({
  docType: z.enum(DOC_TYPES),
  confidence: z.number().min(0).max(1),
  reasoning: z.string().max(500),
});
export type Classification = z.infer<typeof ClassificationSchema>;

export const FuelInvoiceSchema = z.object({
  supplierName: PString,
  invoiceNumber: PString,
  invoiceDate: PDate,
  fuelDescription: PString,
  /** Grade as printed, e.g. "G-10". Left as a raw string; grade mapping is a separate step. */
  fuelGrade: PString.nullable(),
  quantity: PMeasure,
  /** Calorific value if the invoice states one. Often absent — that is normal, not an error. */
  calorificValue: PMeasure.nullable(),
  calorificBasis: provenanced(z.enum(["NCV", "GCV"])).nullable(),
  deliveryPeriodStart: PDate.nullable(),
  deliveryPeriodEnd: PDate.nullable(),
});
export type FuelInvoice = z.infer<typeof FuelInvoiceSchema>;

export const ElectricityBillSchema = z.object({
  utilityName: PString,
  consumerNumber: PString,
  billingPeriodStart: PDate,
  billingPeriodEnd: PDate,
  /** Active energy consumed. Indian HT bills often label this "units". */
  activeEnergy: PMeasure,
  maximumDemand: PMeasure.nullable(),
  /** Present when the connection has on-site or open-access generation to separate out. */
  renewableEnergy: PMeasure.nullable(),
});
export type ElectricityBill = z.infer<typeof ElectricityBillSchema>;

export const LabCertificateSchema = z.object({
  certificateNumber: PString,
  labName: PString,
  nablAccreditationNo: PString.nullable(),
  nablValidUntil: PDate.nullable(),
  sampleId: PString.nullable(),
  sampleDate: PDate.nullable(),
  testDate: PDate,
  materialDescription: PString,
  calorificValue: PMeasure,
  calorificBasis: provenanced(z.enum(["NCV", "GCV"])),
  moisturePct: PNumber.nullable(),
  ashPct: PNumber.nullable(),
});
export type LabCertificate = z.infer<typeof LabCertificateSchema>;

export const DOC_SCHEMAS = {
  fuel_invoice: FuelInvoiceSchema,
  electricity_bill: ElectricityBillSchema,
  lab_certificate: LabCertificateSchema,
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
