import { describe, expect, it } from "vitest";
import { ClassificationSchema, TaxInvoiceSchema } from "./schemas";
import { coerceIsoDate, softenExtraction } from "./soften";

describe("softenExtraction", () => {
  it("rescues a flat GST invoice the way Gemini usually returns it", () => {
    const parsed = TaxInvoiceSchema.parse(
      softenExtraction(
        {
          supplierName: "TechGuruPlus",
          supplierGstin: "07PTAFF9867H1Z4",
          buyerName: "NAZIM KHAN",
          invoiceNumber: "3567/2017-18",
          invoiceDate: "14-Dec-17",
          taxableValue: 56800,
          cgstAmount: 6816,
          sgstAmount: 3408,
          grandTotal: 67024,
          lines: [
            {
              description: "LED LIGHTS",
              hsnCode: 85013410,
              quantity: { value: 50, unit: "pcs" },
              rate: 500,
              amount: "25,000",
            },
          ],
        },
        1
      )
    );

    expect(parsed.supplierName?.value).toBe("TechGuruPlus");
    expect(parsed.invoiceDate?.value).toBe("2017-12-14");
    expect(parsed.grandTotal?.value).toBe(67024);
    expect(parsed.grandTotal?.unitAsPrinted).toBe("");
    expect(parsed.lines[0]?.hsnCode?.value).toBe("85013410");
    expect(parsed.lines[0]?.quantity?.value).toBe(50);
    expect(parsed.lines[0]?.quantity?.unitAsPrinted).toBe("pcs");
    expect(parsed.lines[0]?.amount?.value).toBe(25000);
    expect(parsed.grandTotal?.confidence).toBeLessThan(0.9);
  });

  it("clamps pixel bboxes and empty units on an already-wrapped payload", () => {
    const parsed = TaxInvoiceSchema.parse(
      softenExtraction(
        {
          supplierName: {
            value: "TechGuruPlus",
            confidence: 0.99,
            provenance: {
              page: 1,
              bbox: { x: 120, y: 40, width: 200, height: 20 },
              sourceText: "TechGuruPlus",
            },
          },
          invoiceNumber: {
            value: "3567/2017-18",
            confidence: 0.9,
            provenance: { page: 1, bbox: { x: 0.7, y: 0.2, width: 0.2, height: 0.04 }, sourceText: "3567/2017-18" },
          },
          invoiceDate: {
            value: "14-Dec-17",
            confidence: 0.9,
            provenance: { page: 1, bbox: { x: 0.7, y: 0.24, width: 0.2, height: 0.04 }, sourceText: "14-Dec-17" },
          },
          grandTotal: {
            value: "67,024.00",
            unit: "INR",
            confidence: 0.95,
            provenance: { page: 1, bbox: { x: 0.8, y: 0.8, width: 0.15, height: 0.04 }, sourceText: "67024.00" },
          },
        },
        1
      )
    );

    expect(parsed.supplierName?.provenance.bbox).toEqual({ x: 0, y: 0, width: 1, height: 1 });
    expect(parsed.invoiceDate?.value).toBe("2017-12-14");
    expect(parsed.grandTotal?.value).toBe(67024);
    expect(parsed.grandTotal?.unitAsPrinted).toBe("INR");
    expect(parsed.lines).toEqual([]);
  });
});

describe("coerceIsoDate", () => {
  it("accepts named Indian invoice dates and unambiguous numeric dates", () => {
    expect(coerceIsoDate("14-Dec-17")).toBe("2017-12-14");
    expect(coerceIsoDate("14-Dec-2017")).toBe("2017-12-14");
    expect(coerceIsoDate("2017-12-14")).toBe("2017-12-14");
    expect(coerceIsoDate("14/12/2017")).toBe("2017-12-14");
    expect(coerceIsoDate("12/13/2017")).toBe("2017-12-13");
    expect(coerceIsoDate("01/02/2017")).toBeNull();
  });
});

describe("classification JSON", () => {
  it("accepts a flat classify reply for a coal tax invoice", () => {
    const parsed = ClassificationSchema.parse({
      docType: "fuel_invoice",
      confidence: 0.92,
      reasoning: "TAX INVOICE for Coal 37.220 MT, HSN 270119",
    });
    expect(parsed.docType).toBe("fuel_invoice");
  });

  it("must not run softenExtraction on classify output", () => {
    const raw = {
      docType: "fuel_invoice",
      confidence: 0.92,
      reasoning: "Coal e-invoice",
    };
    expect(ClassificationSchema.safeParse(raw).success).toBe(true);
    expect(ClassificationSchema.safeParse(softenExtraction(raw, 1)).success).toBe(false);
  });
});
