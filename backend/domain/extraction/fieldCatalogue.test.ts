import { describe, expect, it } from "vitest";
import { z } from "zod";
import { fieldCatalogue, type CatalogueEntry } from "./fieldCatalogue";
import { CONFIDENCE_POLICY, DOC_SCHEMAS, FUEL_KINDS, type ExtractableDocType } from "./schemas";

const prov = { page: 1, bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 }, sourceText: "x" };
const leaf = (value: unknown) => ({ value, confidence: 0.95, provenance: prov });
const measure = (value: number, unitAsPrinted = "t") => ({ value, unitAsPrinted, confidence: 0.95, provenance: prov });

/** One fully populated sample per extractable schema (optional fields included). */
const SAMPLES: Record<ExtractableDocType, unknown> = {
  fuel_invoice: {
    supplierName: leaf("A"),
    invoiceNumber: leaf("1"),
    invoiceDate: leaf("01/04/2024"),
    fuelDescription: leaf("coal"),
    fuelGrade: leaf("G-10"),
    quantity: measure(10),
    calorificValue: measure(5000, "kcal/kg"),
    calorificBasis: leaf("GCV"),
    fuelKind: leaf("coal"),
    deliveryPeriodStart: leaf("01/04/2024"),
    deliveryPeriodEnd: leaf("30/04/2024"),
  },
  tax_invoice: {
    supplierName: leaf("A"),
    supplierGstin: leaf("G"),
    buyerName: leaf("B"),
    invoiceNumber: leaf("1"),
    invoiceDate: leaf("01/04/2024"),
    taxableValue: measure(100, ""),
    cgstAmount: measure(9, ""),
    sgstAmount: measure(9, ""),
    grandTotal: measure(118, ""),
    lines: [
      {
        description: leaf("d"),
        hsnCode: leaf("2701"),
        quantity: measure(1),
        rate: measure(2),
        amount: measure(3),
      },
      { description: leaf("e") },
    ],
  },
  electricity_bill: {
    utilityName: leaf("U"),
    consumerNumber: leaf("C"),
    billingPeriodStart: leaf("01/04/2024"),
    billingPeriodEnd: leaf("30/04/2024"),
    activeEnergy: measure(1000, "kWh"),
    maximumDemand: measure(5, "kVA"),
    renewableEnergy: measure(1, "kWh"),
    contractedDemand: measure(6, "kVA"),
    unitCostINRPerKWh: leaf(7),
  },
  lab_certificate: {
    certificateNumber: leaf("1"),
    labName: leaf("L"),
    nablAccreditationNo: leaf("N"),
    nablValidUntil: leaf("01/01/2030"),
    sampleId: leaf("S"),
    sampleDate: leaf("01/04/2024"),
    testDate: leaf("02/04/2024"),
    materialDescription: leaf("coal"),
    calorificValue: measure(5000, "kcal/kg"),
    calorificBasis: leaf("GCV"),
    moisturePct: leaf(5),
    ashPct: leaf(30),
  },
  fuel_consumption_record: {
    fuelKind: leaf("coal"),
    fuelDescription: leaf("coal"),
    supplierName: leaf("A"),
    documentReference: leaf("R"),
    periodStart: leaf("01/04/2024"),
    periodEnd: leaf("30/04/2024"),
    quantity: measure(10),
    calorificValue: measure(5000, "kcal/kg"),
    calorificBasis: leaf("NCV"),
  },
  udyam_certificate: {
    udyamRegistrationNumber: leaf("UDYAM-XX-00-0000000"),
    enterpriseName: leaf("E"),
    enterpriseCategory: leaf("Micro"),
    majorActivity: leaf("m"),
    nicCode: leaf("23"),
    dateOfIncorporation: leaf("01/01/2000"),
    dateOfUdyamRegistration: leaf("01/01/2020"),
    state: leaf("s"),
    district: leaf("d"),
  },
  production_log: {
    productDescription: leaf("clinker"),
    reportingPeriod: leaf("Apr 2024"),
    production: measure(100),
  },
};

/** Independent structural walk over parsed data: collects paths of provenanced leaves. */
function leafPaths(data: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (Array.isArray(data)) {
    for (const item of data) leafPaths(item, prefix ? `${prefix}.*` : "*", out);
  } else if (data && typeof data === "object") {
    const o = data as Record<string, unknown>;
    if ("value" in o && "confidence" in o && "provenance" in o) {
      out.add(prefix);
    } else {
      for (const [k, v] of Object.entries(o)) leafPaths(v, prefix ? `${prefix}.${k}` : k, out);
    }
  }
  return out;
}

const byPath = (entries: CatalogueEntry[]) => new Map(entries.map((e) => [e.path, e]));

describe("fieldCatalogue", () => {
  const types = Object.keys(DOC_SCHEMAS) as ExtractableDocType[];

  it.each(types)("%s: sample parses and every provenanced leaf is catalogued exactly once", (t) => {
    const schema = DOC_SCHEMAS[t];
    const parsed = schema.parse(SAMPLES[t]);
    const expected = leafPaths(parsed);
    const paths = fieldCatalogue(schema).map((e) => e.path);

    expect(expected.size).toBeGreaterThan(0);
    expect(new Set(paths)).toEqual(expected);
    expect(paths.length).toBe(new Set(paths).size);
  });

  it("classifies measure, number, string, date and enum kinds", () => {
    const fuel = byPath(fieldCatalogue(DOC_SCHEMAS.fuel_invoice));
    expect(fuel.get("quantity")?.kind).toBe("measure");
    expect(fuel.get("calorificValue")?.kind).toBe("measure");
    expect(fuel.get("supplierName")?.kind).toBe("string");
    expect(fuel.get("invoiceDate")?.kind).toBe("date");
    expect(fuel.get("deliveryPeriodStart")?.kind).toBe("date");

    const elec = byPath(fieldCatalogue(DOC_SCHEMAS.electricity_bill));
    expect(elec.get("unitCostINRPerKWh")?.kind).toBe("number");
    expect(elec.get("billingPeriodEnd")?.kind).toBe("date");

    const lab = byPath(fieldCatalogue(DOC_SCHEMAS.lab_certificate));
    expect(lab.get("nablValidUntil")?.kind).toBe("date");
    expect(lab.get("moisturePct")?.kind).toBe("number");
  });

  it("lists enum options", () => {
    const rec = byPath(fieldCatalogue(DOC_SCHEMAS.fuel_consumption_record));
    expect(rec.get("fuelKind")).toMatchObject({ kind: "enum", options: [...FUEL_KINDS] });
    expect(rec.get("calorificBasis")).toMatchObject({ kind: "enum", options: ["NCV", "GCV"] });

    const udyam = byPath(fieldCatalogue(DOC_SCHEMAS.udyam_certificate));
    expect(udyam.get("enterpriseCategory")).toMatchObject({
      kind: "enum",
      options: ["Micro", "Small", "Medium"],
    });
  });

  it("omits options for non-enum entries", () => {
    for (const e of fieldCatalogue(DOC_SCHEMAS.fuel_invoice)) {
      expect("options" in e).toBe(false);
    }
  });

  it("uses a * segment for arrays of objects", () => {
    const paths = fieldCatalogue(DOC_SCHEMAS.tax_invoice).map((e) => e.path);
    expect(paths).toEqual(
      expect.arrayContaining([
        "lines.*.description",
        "lines.*.hsnCode",
        "lines.*.quantity",
        "lines.*.rate",
        "lines.*.amount",
      ]),
    );
    expect(byPath(fieldCatalogue(DOC_SCHEMAS.tax_invoice)).get("lines.*.quantity")?.kind).toBe("measure");
  });

  it("flags regulatory only for always-review keys", () => {
    for (const t of types) {
      for (const e of fieldCatalogue(DOC_SCHEMAS[t])) {
        const key = e.path.split(".").pop() as string;
        if (CONFIDENCE_POLICY.alwaysReview.has(key)) {
          expect(e.regulatory, `${t}:${e.path}`).toBe(true);
        } else {
          expect("regulatory" in e, `${t}:${e.path}`).toBe(false);
        }
      }
    }
    const fuel = byPath(fieldCatalogue(DOC_SCHEMAS.fuel_invoice));
    expect(fuel.get("quantity")?.regulatory).toBe(true);
    expect(fuel.get("supplierName")?.regulatory).toBeUndefined();
  });

  it("unwraps optional, nullable and default wrappers", () => {
    const leafSchema = z.object({
      value: z.string(),
      confidence: z.number(),
      provenance: z.object({}),
    });
    const schema = z.object({
      a: leafSchema.optional(),
      b: leafSchema.nullable(),
      c: leafSchema.nullish(),
    });
    expect(fieldCatalogue(schema).map((e) => e.path)).toEqual(["a", "b", "c"]);
  });

  it("returns an empty catalogue for a schema without provenanced leaves", () => {
    expect(fieldCatalogue(z.object({ x: z.string() }))).toEqual([]);
  });
});
