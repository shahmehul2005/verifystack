import { describe, expect, it } from "vitest";
import { CEMENT_REGISTRY, registryForPack } from "./index";
import { annotateDocument, annotateField, carriedRegistryColumns, documentPeriod, isMissingRegistryColumn, NO_ANNOTATION, registryColumns } from "./annotate";
import { qualifyExtractedFieldPaths } from "../extraction/fieldPaths";

const R = CEMENT_REGISTRY;
const field = (fieldPath: string, value: unknown) => ({ fieldPath, value });

describe("registryForPack", () => {
  it("has a registry for the cement pack and none for any other", () => {
    expect(registryForPack("CCTS-CEMENT-v1")).toBe(CEMENT_REGISTRY);
    expect(registryForPack("CCTS-STEEL-v1")).toBeNull();
    expect(registryForPack("ADEETIE-TEXTILE-v1")).toBeNull();
    expect(registryForPack("")).toBeNull();
  });
});

describe("grid electricity from a bill", () => {
  const fields = [
    field("electricity.activeEnergy", 1_250_000),
    field("billingPeriodStart", "2023-11-01"),
    field("billingPeriodEnd", "2023-11-30"),
    field("electricity.contractedDemand", 2500),
    field("utilityName", "DISCOM"),
  ];

  it("keys the active energy and gives it the bill's period", () => {
    const out = annotateDocument(R, "electricity_bill", fields);
    expect(out.get("electricity.activeEnergy")).toEqual({
      canonicalKey: "grid_electricity_import",
      periodStart: "2023-11-01",
      periodEnd: "2023-11-30",
      periodStatus: "known",
      periodNote: null,
      registryVersion: R.version,
    });
  });

  it("leaves every other field of the bill unannotated", () => {
    const out = annotateDocument(R, "electricity_bill", fields);
    expect([...out.keys()]).toEqual(["electricity.activeEnergy"]);
  });

  it("records an unknown period with its reason, and still keys the value", () => {
    const out = annotateDocument(R, "electricity_bill", [field("electricity.activeEnergy", 1000)]);
    expect(out.get("electricity.activeEnergy")).toMatchObject({
      canonicalKey: "grid_electricity_import",
      periodStart: null,
      periodEnd: null,
      periodStatus: "unknown",
      periodNote: expect.stringMatching(/Only one end|No reporting period/),
    });
  });

  it("does not guess a period from one end of it", () => {
    const out = annotateDocument(R, "electricity_bill", [field("electricity.activeEnergy", 1000), field("billingPeriodStart", "2023-11-01")]);
    expect(out.get("electricity.activeEnergy")).toMatchObject({ periodStatus: "unknown", periodStart: null });
  });

  it("finds the period when it is on a different page from the quantity", () => {
    // The caller passes the fields of every page together.
    const out = annotateDocument(R, "electricity_bill", [field("billingPeriodEnd", "30/11/2023"), field("electricity.activeEnergy", 5), field("billingPeriodStart", "01/11/2023")]);
    expect(out.get("electricity.activeEnergy")).toMatchObject({ periodStatus: "known", periodStart: "2023-11-01", periodEnd: "2023-11-30" });
  });

  it("says so when it had to assume a day-first date", () => {
    const out = annotateDocument(R, "electricity_bill", [field("electricity.activeEnergy", 5), field("billingPeriodStart", "03/04/2023"), field("billingPeriodEnd", "30/04/2023")]);
    expect(out.get("electricity.activeEnergy")).toMatchObject({ periodStatus: "known", periodStart: "2023-04-03" });
    expect(out.get("electricity.activeEnergy")!.periodNote).toMatch(/day-first/);
  });
});

describe("coal GCV from a laboratory certificate and a fuel invoice", () => {
  it("keys a certificate's calorific value, with the sample day as its period", () => {
    const out = annotateDocument(R, "lab_certificate", [field("calorificValue", 4200), field("sampleDate", "2023-11-15"), field("calorificBasis", "ARB")]);
    expect(out.get("calorificValue")).toMatchObject({ canonicalKey: "coal_gcv", periodStatus: "known", periodStart: "2023-11-15", periodEnd: "2023-11-15" });
    // The basis word is a different thing from the value; it is not keyed as GCV.
    expect(out.has("calorificBasis")).toBe(false);
  });

  it("marks the period unknown when the certificate prints no sample date", () => {
    const out = annotateDocument(R, "lab_certificate", [field("calorificValue", 4200), field("testDate", "2023-11-20")]);
    expect(out.get("calorificValue")).toMatchObject({ canonicalKey: "coal_gcv", periodStatus: "unknown" });
  });

  it("keys a fuel invoice's calorific value only where it is coal's: unqualified, or under coal", () => {
    const base = [field("deliveryPeriodStart", "2023-11-01"), field("deliveryPeriodEnd", "2023-11-30")];
    expect(annotateDocument(R, "fuel_invoice", [...base, field("calorificValue", 4200)]).get("calorificValue")).toMatchObject({ canonicalKey: "coal_gcv" });
    expect(annotateDocument(R, "fuel_invoice", [...base, field("coal.calorificValue", 4200)]).get("coal.calorificValue")).toMatchObject({ canonicalKey: "coal_gcv" });
    // Another fuel's calorific value is a different quantity.
    for (const path of ["petcoke.calorificValue", "furnaceOil.calorificValue", "lignite.calorificValue"]) {
      expect(annotateDocument(R, "fuel_invoice", [...base, field(path, 6500)]).has(path), path).toBe(false);
    }
  });

  it("uses a fuel invoice's delivery period, never its invoice date", () => {
    const withDate = annotateDocument(R, "fuel_invoice", [field("calorificValue", 4200), field("invoiceDate", "2023-12-02")]);
    expect(withDate.get("calorificValue")).toMatchObject({ periodStatus: "unknown", periodStart: null });
  });
});

describe("what is not mapped stays null", () => {
  it("does not key a production log: its leaf could be clinker or equivalent product", () => {
    const out = annotateDocument(R, "production_log", [field("production", 12_500), field("reportingPeriod", "November 2023")]);
    expect(out.size).toBe(0);
  });

  it("does not key fuel quantities or any document outside the registry", () => {
    expect(annotateDocument(R, "fuel_invoice", [field("quantity", 100), field("coal.quantity", 100)]).size).toBe(0);
    expect(annotateDocument(R, "tax_invoice", [field("grandTotal", 100)]).size).toBe(0);
    expect(annotateDocument(R, "udyam_certificate", [field("enterpriseName", "X")]).size).toBe(0);
  });

  it("does nothing without a registry", () => {
    expect(annotateDocument(null, "electricity_bill", [field("electricity.activeEnergy", 1)]).size).toBe(0);
  });

  it("assesses a period only for a document type that states one", () => {
    expect(documentPeriod("tax_invoice", [field("invoiceDate", "2023-11-01")])).toBeNull();
    expect(documentPeriod("electricity_bill", [])).toMatchObject({ status: "unknown" });
    expect(annotateField(R, "tax_invoice", "grandTotal", null)).toEqual(NO_ANNOTATION);
  });
});

describe("the registry's extraction paths agree with the real path rewrite", () => {
  it("a bill's active energy and a certificate's calorific value are stored at a path the registry keys", () => {
    for (const [docType, leaf] of [
      ["electricity_bill", "activeEnergy"],
      ["lab_certificate", "calorificValue"],
      ["fuel_invoice", "calorificValue"],
    ] as const) {
      const stored = qualifyExtractedFieldPaths([{ fieldPath: leaf, value: 1 }])[0]!.fieldPath;
      expect(annotateField(R, docType, stored, null).canonicalKey, `${docType}.${stored}`).not.toBeNull();
    }
  });

  it("a fuel invoice read as coal is stored where the registry still keys it", () => {
    const stored = qualifyExtractedFieldPaths([
      { fieldPath: "fuelKind", value: "coal" },
      { fieldPath: "calorificValue", value: 1 },
    ])[1]!.fieldPath;
    expect(stored).toBe("coal.calorificValue");
    expect(annotateField(R, "fuel_invoice", stored, null).canonicalKey).toBe("coal_gcv");
  });

  it("a fuel invoice read as petcoke is not keyed as coal", () => {
    const stored = qualifyExtractedFieldPaths([
      { fieldPath: "fuelKind", value: "petcoke" },
      { fieldPath: "calorificValue", value: 1 },
    ])[1]!.fieldPath;
    expect(annotateField(R, "fuel_invoice", stored, null).canonicalKey).toBeNull();
  });
});

describe("database columns", () => {
  const known = annotateDocument(R, "electricity_bill", [field("electricity.activeEnergy", 1), field("billingPeriodStart", "2023-11-01"), field("billingPeriodEnd", "2023-11-30")]).get("electricity.activeEnergy")!;

  it("writes the six registry columns", () => {
    expect(registryColumns(known)).toEqual({
      canonical_key: "grid_electricity_import",
      period_start: "2023-11-01",
      period_end: "2023-11-30",
      period_status: "known",
      period_note: null,
      registry_version: R.version,
    });
  });

  it("carries a key and its period from an extracted field onto the fact, as it is", () => {
    expect(carriedRegistryColumns(registryColumns(known))).toEqual(registryColumns(known));
    const unknown = annotateDocument(R, "electricity_bill", [field("electricity.activeEnergy", 1)]).get("electricity.activeEnergy")!;
    expect(carriedRegistryColumns(registryColumns(unknown))).toMatchObject({ canonical_key: "grid_electricity_import", period_status: "unknown", period_start: null });
  });

  it("carries nothing when the field has no key, or the database has no such column", () => {
    expect(carriedRegistryColumns({})).toEqual({});
    expect(carriedRegistryColumns({ canonical_key: null })).toEqual({});
    expect(carriedRegistryColumns({ canonical_key: null, period_status: "known" })).toEqual({});
  });

  it("recognises a database without the migration", () => {
    expect(isMissingRegistryColumn({ code: "42703" })).toBe(true);
    expect(isMissingRegistryColumn({ code: "PGRST204" })).toBe(true);
    expect(isMissingRegistryColumn({ message: "Could not find the 'canonical_key' column of 'extracted_fields'" })).toBe(true);
    expect(isMissingRegistryColumn({ code: "23505", message: "duplicate key" })).toBe(false);
  });
});
