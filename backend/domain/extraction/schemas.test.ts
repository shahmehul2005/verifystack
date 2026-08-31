import { describe, expect, it } from "vitest";
import {
  TaxInvoiceSchema,
  isExtractable,
  triageFields,
} from "./schemas";

const box = { x: 0.1, y: 0.2, width: 0.3, height: 0.04 };
const provenance = { page: 1, bbox: box, sourceText: "printed" };

function p<T>(value: T, confidence = 0.95) {
  return { value, confidence, provenance };
}

function measure(value: number, unitAsPrinted: string, confidence = 0.95) {
  return { value, unitAsPrinted, confidence, provenance: { ...provenance, sourceText: String(value) } };
}

describe("tax invoice extraction", () => {
  it("is extractable so a GST commercial invoice is not left as unknown", () => {
    expect(isExtractable("tax_invoice")).toBe(true);
    expect(isExtractable("production_log")).toBe(true);
    expect(isExtractable("unknown")).toBe(false);
  });

  it("accepts a typical Indian GST invoice payload", () => {
    const parsed = TaxInvoiceSchema.parse({
      supplierName: p("TechGuruPlus"),
      supplierGstin: p("07PTAFF9867H1Z4"),
      buyerName: p("NAZIM KHAN"),
      invoiceNumber: p("3567/2017-18"),
      invoiceDate: p("2017-12-14"),
      taxableValue: measure(56800, "INR"),
      cgstAmount: measure(6816, "INR"),
      sgstAmount: measure(3408, "INR"),
      grandTotal: measure(67024, "INR"),
      lines: [
        {
          description: p("LED LIGHTS"),
          hsnCode: p("85013410"),
          quantity: measure(50, "pcs"),
          rate: measure(500, "INR"),
          amount: measure(25000, "INR"),
        },
      ],
    });
    expect(parsed.grandTotal?.value).toBe(67024);
    expect(parsed.lines).toHaveLength(1);
  });

  it("routes grand total and line quantities to human review with dotted array paths", () => {
    const decisions = triageFields({
      supplierName: p("TechGuruPlus"),
      grandTotal: measure(67024, "INR"),
      taxableValue: measure(56800, "INR"),
      lines: [
        {
          description: p("LED LIGHTS"),
          quantity: measure(50, "pcs"),
        },
      ],
    });
    const byPath = Object.fromEntries(decisions.map((d) => [d.fieldPath, d]));
    expect(byPath.grandTotal?.action).toBe("human_review");
    expect(byPath.taxableValue?.action).toBe("human_review");
    expect(byPath["lines.0.quantity"]?.action).toBe("human_review");
    expect(byPath["lines.0.description"]?.action).toBe("auto_commit");
  });
});
