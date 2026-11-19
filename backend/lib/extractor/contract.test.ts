/**
 * Contract test. The JSON files in `__fixtures__/` are real responses produced by the
 * Python service (`services/extractor/tests/test_contract_fixtures.py` regenerates and
 * shape-checks them). They must parse with the client's strict Zod schemas and survive
 * the provider's rebuild + `DOC_SCHEMAS` validation.
 */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import {
  ClassifyResponseSchema,
  FieldsResponseSchema,
  type extractorClient,
} from "@verifystack/backend/lib/extractor/client";
import { ExtractorServiceProvider } from "@verifystack/backend/domain/extraction/extractorServiceProvider";
import type { DocumentPage } from "@verifystack/backend/domain/extraction/provider";
import { DOC_SCHEMAS } from "@verifystack/backend/domain/extraction/schemas";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

const load = (name: string): unknown =>
  JSON.parse(readFileSync(join(__dirname, "__fixtures__", `${name}.json`), "utf8"));

const page: DocumentPage = {
  evidenceId: "ev1",
  pageNumber: 1,
  mimeType: "application/pdf",
  data: Buffer.from("pdf").toString("base64"),
};

function providerReturning(fixture: unknown) {
  const parsed = FieldsResponseSchema.parse(fixture);
  const client = {
    extractFields: vi.fn().mockResolvedValue({ ok: true, data: parsed }),
  } as unknown as typeof extractorClient;
  return new ExtractorServiceProvider(client);
}

describe("extractor service contract", () => {
  it("parses the classify response", () => {
    const r = ClassifyResponseSchema.safeParse(load("classify"));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it.each(["fuel_invoice_fields", "tax_invoice_fields"])("parses %s", (name) => {
    const r = FieldsResponseSchema.safeParse(load(name));
    expect(r.success, JSON.stringify(r.error?.issues)).toBe(true);
  });

  it("fuel_invoice: extract is ok, nested, and keeps the null field null", async () => {
    const res = await providerReturning(load("fuel_invoice_fields")).extract(
      page,
      "fuel_invoice",
      DOC_SCHEMAS.fuel_invoice,
    );
    expect(res.ok).toBe(true);
    expect(res.validationErrors).toBeUndefined();
    const d = res.data as Record<string, Any>;
    expect(d.supplierName.value).toBe("Bharat Petroleum Corporation Ltd");
    expect(d.quantity.value).toBe(12500);
    expect(d.quantity.unitAsPrinted).toBe("Litres");
    expect(d.quantity.provenance.page).toBe(1);
    expect(d.invoiceDate.value).toBe("2025-05-12");
    expect(d.calorificValue ?? null).toBeNull();
  });

  it("tax_invoice: lines.N paths rebuild into an array of provenanced leaves", async () => {
    const res = await providerReturning(load("tax_invoice_fields")).extract(
      page,
      "tax_invoice",
      DOC_SCHEMAS.tax_invoice,
    );
    expect(res.ok).toBe(true);
    expect(res.validationErrors).toBeUndefined();
    const d = res.data as Record<string, Any>;
    expect(Array.isArray(d.lines)).toBe(true);
    expect(d.lines).toHaveLength(2);
    expect(d.lines[0].description.value).toBe("Steel rods");
    expect(d.lines[0].quantity.unitAsPrinted).toBe("MT");
    expect(d.lines[1].description.value).toBe("Binding wire");
    expect(d.lines[1].quantity.value).toBe(2);
    expect(d.grandTotal.unitAsPrinted).toBe("");
  });
});
