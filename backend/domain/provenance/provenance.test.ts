import { describe, expect, it } from "vitest";
import {
  describeProvenance,
  factLabel,
  hasProvenance,
  provenanceFromColumns,
  provenanceToColumns,
  type Provenance,
} from "./index";

const BBOX = { x: 0.1, y: 0.1, width: 0.2, height: 0.05 };
const OBS_ID = "4f9a6f5c-2f3e-4b0b-9d1e-0c8c2a6a9b11";

describe("provenanceFromColumns", () => {
  it("reads legacy rows (no provenance_type) as page evidence", () => {
    const p = provenanceFromColumns({
      document_id: "doc-1",
      page: 2,
      bbox: BBOX,
      source_text: "Quantity dispatched 18,247 MT",
    });
    expect(p?.type).toBe("document_page");
  });

  it("rejects page evidence missing any of page, bbox or source text", () => {
    expect(provenanceFromColumns({ page: 1, bbox: BBOX, source_text: "" })).toBeNull();
    expect(provenanceFromColumns({ page: 0, bbox: BBOX, source_text: "x" })).toBeNull();
    expect(provenanceFromColumns({ page: 1, bbox: null, source_text: "x" })).toBeNull();
    expect(provenanceFromColumns({})).toBeNull();
  });

  it("accepts a spreadsheet cell and takes the document from the column", () => {
    const p = provenanceFromColumns({
      provenance_type: "spreadsheet_cell",
      document_id: "doc-2",
      provenance: { sheet: "Sheet 2", cellRef: "D14", value: 18247 },
    });
    expect(p).toMatchObject({ type: "spreadsheet_cell", documentId: "doc-2", cellRef: "D14" });
  });

  it("rejects a malformed cell reference and a reversed time range", () => {
    expect(
      provenanceFromColumns({
        provenance_type: "spreadsheet_cell",
        document_id: "d",
        provenance: { sheet: "S", cellRef: "14D", value: 1 },
      })
    ).toBeNull();
    expect(
      provenanceFromColumns({
        provenance_type: "time_series_range",
        document_id: "d",
        provenance: {
          tag: "kiln_amps",
          start: "2025-10-02T00:00:00Z",
          end: "2025-10-01T00:00:00Z",
          aggregation: "mean",
          rowCount: 10,
        },
      })
    ).toBeNull();
  });

  it("accepts a site observation without any document", () => {
    const p = provenanceFromColumns({
      provenance_type: "site_observation",
      provenance: {
        observationId: OBS_ID,
        observer: "A. Verma",
        timestamp: "2025-11-04T09:30:00+05:30",
        evidenceFileIds: [],
      },
    });
    expect(p?.type).toBe("site_observation");
  });

  it("rejects an unknown provenance type", () => {
    expect(provenanceFromColumns({ provenance_type: "hearsay", provenance: {} })).toBeNull();
  });
});

describe("provenanceToColumns", () => {
  it("round-trips every type", () => {
    const samples: Provenance[] = [
      { type: "document_page", documentId: "d", page: 3, bbox: BBOX, sourceText: "text" },
      { type: "spreadsheet_cell", documentId: "d", sheet: "S1", cellRef: "B2", value: 4, formula: "=A1+3" },
      {
        type: "time_series_range",
        documentId: "d",
        tag: "grid_kwh",
        start: "2025-04-01T00:00:00Z",
        end: "2025-04-30T23:59:00Z",
        aggregation: "sum",
        rowCount: 43200,
      },
      {
        type: "site_observation",
        observationId: OBS_ID,
        observer: "R. Iyer",
        timestamp: "2025-11-04T10:00:00Z",
        evidenceFileIds: ["file-1"],
      },
    ];
    for (const sample of samples) {
      const cols = provenanceToColumns(sample);
      expect(provenanceFromColumns(cols)).toEqual(sample);
    }
  });

  it("keeps page evidence in the legacy columns only", () => {
    const cols = provenanceToColumns({
      type: "document_page",
      documentId: "d",
      page: 1,
      bbox: BBOX,
      sourceText: "t",
    });
    expect(cols.provenance).toBeNull();
    expect(cols.page).toBe(1);
  });
});

describe("describe and label", () => {
  it("describes where a value came from, per type", () => {
    const cell: Provenance = { type: "spreadsheet_cell", documentId: "d", sheet: "Inputs", cellRef: "C7", value: 12.5 };
    expect(describeProvenance(cell).detail).toBe("Inputs!C7 = 12.5");
    expect(factLabel({ provenance_type: "document_page", document_id: "d", page: 1, bbox: BBOX, source_text: "kg" })).toBe("kg");
    expect(hasProvenance({})).toBe(false);
  });
});
