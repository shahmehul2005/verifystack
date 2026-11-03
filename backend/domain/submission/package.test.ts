import { describe, expect, it } from "vitest";
import { openZip } from "../archive/zip";
import { sha256Hex } from "../canonical";
import { importEvidencePack } from "../intake/evidencePack";
import { sanitizeArchiveName } from "./names";
import { buildSubmissionPackage, submissionBlockers, SubmissionError, type SubmissionInput } from "./package";

const evidence = new TextEncoder().encode("coal invoice bytes");

function input(over: Partial<SubmissionInput> = {}): SubmissionInput {
  return {
    generatedAt: "2026-10-09T10:00:00Z",
    engagement: {
      id: "eng-1",
      client_name: "Aravalli Cement",
      plant_name: "Unit 1",
      compliance_year: "FY2024-25",
      pack_id: "CCTS-CEMENT-v1",
      pack_version: "1.0.0",
      scheme: "CCTS",
      status: "submitted",
    },
    facts: [
      {
        id: "f2", field_path: "production", value_json: 18247.5, unit: "t", provenance_type: "document_page", provenance: null,
        document_id: "d1", page: 2, bbox: { x: 0.1, y: 0.1, width: 0.2, height: 0.05 }, source_text: "Clinker dispatched 18,247.5 MT",
        accepted_by: "u1", accepted_at: "2026-10-01T00:00:00Z", accept_mode: "individual",
      },
      {
        id: "f1", field_path: "coal.quantity", value_json: 9000, unit: "t", provenance_type: "spreadsheet_cell",
        provenance: { sheet: "Fuel", cellRef: "C5", value: 9000 }, document_id: "d2", page: null, bbox: null, source_text: null,
        accepted_by: "u1", accepted_at: "2026-10-01T00:00:00Z", accept_mode: "bulk",
      },
    ],
    run: {
      id: "r1", engine_version: "gei-1", pack_version: "1.0.0", factor_set_version: "fs-1", input_hash: "abc", previous_run_hash: null,
      draft_mode: false, inputs: { a: 1 }, result: { gei: 0.82 }, created_at: "2026-10-02T00:00:00Z",
    },
    findings: [
      { id: "i1", rule_id: "EF001", severity: "block", title: "Grid vintage", state: "closed", clause_ref: "cl 4", due_at: null },
    ],
    signoffs: [
      { role: "lead_verifier", attestor_name: "A. Lead", report_hash: "h1", statement: "ok", created_at: "2026-10-03T00:00:00Z" },
      { role: "independent_reviewer", attestor_name: "B. Reviewer", report_hash: "h2", statement: "ok", created_at: "2026-10-04T00:00:00Z" },
    ],
    technicalReview: { status: "approved", reviewer: "B. Reviewer", at: "2026-10-03T12:00:00Z" },
    documents: [
      { id: "d1", sha256: sha256Hex(evidence), original_filename: "Coal Invoice (final).pdf", mime_type: "application/pdf", byte_size: evidence.length, doc_type: "fuel_invoice", bytes: evidence },
      { id: "d2", sha256: "e".repeat(64), original_filename: "fuel.xlsx", mime_type: null, byte_size: 10, doc_type: null },
    ],
    acceptance: { total: 2, individual: 1, bulk: 1, bulkShare: 0.5 },
    unverifiedFactors: ["ef_pfc_anode_effect"],
    openItems: ["Scheme submission template not confirmed"],
    ...over,
  };
}

describe("buildSubmissionPackage", () => {
  it("builds a package whose manifest hashes verify and which re-imports cleanly", () => {
    const pkg = buildSubmissionPackage(input());
    const imported = importEvidencePack(pkg.bytes);
    const names = imported.files.map((f) => f.path);
    for (const n of ["README.txt", "calculation-run.json", "evidence-index.csv", "facts.csv", "findings.csv", "signoffs.csv"]) {
      expect(names).toContain(n);
    }
    expect(names.filter((n) => n.startsWith("evidence/"))).toHaveLength(1);
    expect(names).toHaveLength(7);
    expect(pkg.includedEvidenceFiles).toBe(1);
    expect(pkg.manifest.package).toMatchObject({ layoutUnverified: true, runInputHash: "abc" });
  });

  it("is deterministic", () => {
    const a = buildSubmissionPackage(input());
    const b = buildSubmissionPackage(input());
    expect(a.sha256).toBe(b.sha256);
    expect(buildSubmissionPackage(input({ generatedAt: "2026-10-10T00:00:00Z" })).sha256).not.toBe(a.sha256);
  });

  it("states the generic layout and the bulk share up front, and lists unverified factors", () => {
    const readme = openZip(buildSubmissionPackage(input()).bytes).readText("README.txt");
    expect(readme).toMatch(/layout of this package is generic/);
    expect(readme).toMatch(/50\.0% bulk/);
    expect(readme).toMatch(/ef_pfc_anode_effect/);
    expect(readme).toMatch(/Scheme submission template not confirmed/);
  });

  it("writes provenance detail for every evidence type and neutralises formula injection", () => {
    const zip = openZip(buildSubmissionPackage(input()).bytes);
    const facts = zip.readText("facts.csv");
    expect(facts).toMatch(/Fuel!C5 = 9000/);
    expect(facts).toMatch(/Page 2/);
    const bad = buildSubmissionPackage(
      input({ findings: [{ id: "i", rule_id: "X", severity: "info", title: "=cmd|' /C calc'!A0", state: "closed", clause_ref: "-", due_at: null }] })
    );
    expect(openZip(bad.bytes).readText("findings.csv")).toMatch(/'=cmd/);
  });

  it("refuses to bundle a file whose bytes do not match its hash", () => {
    const tampered = input();
    tampered.documents[0] = { ...tampered.documents[0]!, bytes: new TextEncoder().encode("other") };
    expect(() => buildSubmissionPackage(tampered)).toThrow(/does not match its recorded hash/);
  });
});

describe("submissionBlockers", () => {
  it("is empty when everything is in place", () => {
    expect(submissionBlockers(input())).toEqual([]);
  });

  it("lists every reason it cannot be built, and the builder refuses", () => {
    const bad = input({
      run: null,
      findings: [{ id: "i", rule_id: "X", severity: "block", title: "t", state: "open", clause_ref: "c", due_at: null }],
      signoffs: [],
      technicalReview: { status: "stale" },
    });
    const b = submissionBlockers(bad);
    expect(b.join(" ")).toMatch(/No calculation run/);
    expect(b.join(" ")).toMatch(/block issue/);
    expect(b.join(" ")).toMatch(/lead verifier/);
    expect(b.join(" ")).toMatch(/independent reviewer/);
    expect(b.join(" ")).toMatch(/Technical review is stale/);
    expect(() => buildSubmissionPackage(bad)).toThrow(SubmissionError);
  });

  it("blocks a draft-mode run", () => {
    const i = input();
    i.run!.draft_mode = true;
    expect(submissionBlockers(i)).toContain("The latest run was made in draft mode.");
  });
});

describe("sanitizeArchiveName", () => {
  it("keeps names safe and non-empty", () => {
    expect(sanitizeArchiveName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeArchiveName("Résumé final.pdf")).toBe("Resume-final.pdf");
    expect(sanitizeArchiveName("...")).toBe("file");
  });
});
