import { describe, expect, it } from "vitest";
import { parseCsv } from "../intake/csv";
import { BulkImportError, IMPORT_TEMPLATE_CSV, mapHeaders, MAX_IMPORT_ROWS, previewBulkImport } from "./bulkImport";

const csv = (text: string) => parseCsv(text).rows;

describe("mapHeaders", () => {
  it("matches canonical names and common aliases, and reports the rest", () => {
    const m = mapHeaders(["Pack", "Entity Name", "Site", "FY", "Remarks"]);
    expect([...m.byIndex.values()]).toEqual(["packId", "clientName", "plantName", "complianceYear"]);
    expect(m.unmapped).toEqual(["Remarks"]);
    expect(m.missingRequired).toEqual([]);
  });
  it("lists missing required columns", () => {
    expect(mapHeaders(["clientName"]).missingRequired).toEqual(["packId", "complianceYear"]);
  });
  it("does not map one column to two fields", () => {
    const m = mapHeaders(["client", "clientName"]);
    expect(m.byIndex.size).toBe(1);
    expect(m.unmapped).toEqual(["clientName"]);
  });
});

describe("previewBulkImport", () => {
  it("accepts the shipped template", () => {
    const p = previewBulkImport(csv(IMPORT_TEMPLATE_CSV));
    expect(p.invalidCount).toBe(0);
    expect(p.rows[0]!.input).toMatchObject({ packId: "CCTS-CEMENT-v1", clientName: "Example Cement Ltd", geiTarget: 0.85 });
  });

  it("reports each bad row with its file row number and keeps the good ones", () => {
    const p = previewBulkImport(
      csv(
        [
          "packId,clientName,plantName,complianceYear,geiTarget",
          "CCTS-CEMENT-v1,Good Ltd,Unit 1,FY2024-25,0.8",
          "NOPE-v9,Bad Pack Ltd,,FY2024-25,",
          "CCTS-CEMENT-v1,,,FY2024-25,",
          "CCTS-CEMENT-v1,Junk Target,,FY2024-25,abc",
        ].join("\n")
      )
    );
    expect(p.validCount).toBe(1);
    expect(p.rows.map((r) => [r.row, r.ok])).toEqual([[2, true], [3, false], [4, false], [5, false]]);
    expect(p.rows[1]!.errors.join(" ")).toMatch(/unknown pack/);
    expect(p.rows[2]!.errors.join(" ")).toMatch(/clientName/);
    expect(p.rows[3]!.errors.join(" ")).toMatch(/geiTarget/);
  });

  it("parses rupee and percent formatting", () => {
    const p = previewBulkImport(
      csv(
        [
          "packId,clientName,complianceYear,loanAmountInr,sanctionedInterestRatePct,enterpriseCategory",
          'ADEETIE-FOUNDRY-v1,Foundry Co,FY2025-26,"₹ 12,50,000",7.5%,Small',
        ].join("\n")
      )
    );
    expect(p.rows[0]!.errors).toEqual([]);
    expect(p.rows[0]!.input).toMatchObject({ loanAmountInr: 1_250_000, sanctionedInterestRatePct: 7.5, enterpriseCategory: "Small" });
  });

  it("flags duplicates inside the file and ADEETIE-only columns on a CCTS row", () => {
    const p = previewBulkImport(
      csv(
        [
          "packId,clientName,plantName,complianceYear,loanAmountInr",
          "CCTS-CEMENT-v1,Dup Ltd,U1,FY2024-25,100",
          "CCTS-CEMENT-v1,dup ltd,u1,FY2024-25,",
        ].join("\n")
      )
    );
    expect(p.rows[0]!.warnings.join(" ")).toMatch(/ADEETIE only/);
    expect(p.rows[1]!.errors.join(" ")).toMatch(/Duplicates row 2/);
  });

  it("refuses structure-only packs", () => {
    const p = previewBulkImport(csv("packId,clientName,complianceYear\nCBAM-STRUCTURE-v0,X,FY2024-25"));
    expect(p.rows[0]!.errors.join(" ")).toMatch(/structure only/);
  });

  it("returns header problems instead of rows, and skips blank lines", () => {
    expect(previewBulkImport(csv("clientName\nA")).headerProblems.join(" ")).toMatch(/packId/);
    const p = previewBulkImport([["packId", "clientName", "complianceYear"], ["", "", ""], ["CCTS-CEMENT-v1", "A", "FY2024-25"]]);
    expect(p.rows).toHaveLength(1);
  });

  it("enforces size limits", () => {
    expect(() => previewBulkImport([["packId"]])).toThrow(BulkImportError);
    const big = [["packId", "clientName", "complianceYear"], ...Array.from({ length: MAX_IMPORT_ROWS + 1 }, (_, i) => ["CCTS-CEMENT-v1", `C${i}`, "FY2024-25"])];
    expect(() => previewBulkImport(big)).toThrow(/at most/);
  });
});
