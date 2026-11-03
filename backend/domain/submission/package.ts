/**
 * Submission package (DFD 8.7).
 *
 * A single ZIP a firm can hand over: the facts with their provenance, the
 * calculation record, the findings and their outcome, the sign-offs, an index
 * of the evidence files, and a manifest that hashes every part. The manifest is
 * also a valid evidence pack, so the package can be re-imported to prove it
 * round-trips.
 *
 * It does not claim to be a scheme's own submission format. Scheme and portal
 * templates have not been supplied, so the layout is generic and every pack
 * format is flagged `layoutUnverified`. README.txt says so on the first line a
 * recipient reads.
 *
 * Deterministic: the same input (including `generatedAt`, which the caller
 * supplies) produces byte-identical output, so the package hash is a stable
 * identifier for what was submitted.
 */

import { writeZip } from "../archive/zip";
import { toCsv } from "../intake/csv";
import { canonicalJson, sha256Hex } from "../canonical";
import { describeProvenance, provenanceFromColumns } from "../provenance";
import { isBlockingOpen, type IssueSeverity, type IssueState } from "../issues/lifecycle";
import type { TechnicalReviewStatus } from "../review/technical";
import type { AcceptanceShare } from "../triage/risk";
import { EVIDENCE_PACK_FORMAT, EVIDENCE_PACK_VERSION } from "../intake/evidencePack";
import { sanitizeArchiveName } from "./names";

export const SUBMISSION_PACKAGE_VERSION = 1;

export class SubmissionError extends Error {
  constructor(
    message: string,
    readonly blockers: string[] = []
  ) {
    super(message);
    this.name = "SubmissionError";
  }
}

export interface SubmissionFact {
  id: string;
  field_path: string;
  value_json: unknown;
  unit: string | null;
  provenance_type: string | null;
  provenance: unknown;
  document_id: string | null;
  page: number | null;
  bbox: unknown;
  source_text: string | null;
  accepted_by: string | null;
  accepted_at: string;
  accept_mode: "individual" | "bulk" | null;
}

export interface SubmissionDocument {
  id: string;
  sha256: string;
  original_filename: string;
  mime_type: string | null;
  byte_size: number | null;
  doc_type: string | null;
  /** When present the file is bundled; when absent it is indexed only. */
  bytes?: Uint8Array;
}

export interface SubmissionInput {
  generatedAt: string;
  engagement: {
    id: string;
    client_name: string;
    plant_name: string | null;
    compliance_year: string;
    pack_id: string;
    pack_version: string;
    scheme: string;
    status: string;
    adeetie_phase?: string | null;
  };
  facts: SubmissionFact[];
  run: {
    id: string;
    engine_version: string;
    pack_version: string;
    factor_set_version: string;
    input_hash: string;
    previous_run_hash: string | null;
    draft_mode: boolean;
    inputs: unknown;
    result: unknown;
    created_at: string;
  } | null;
  findings: Array<{
    id: string;
    rule_id: string;
    severity: IssueSeverity;
    title: string;
    state: IssueState;
    clause_ref: string;
    due_at?: string | null;
  }>;
  signoffs: Array<{
    role: string;
    attestor_name: string;
    report_hash: string;
    statement: string;
    created_at: string;
  }>;
  technicalReview: { status: TechnicalReviewStatus; reviewer?: string | null; at?: string | null };
  documents: SubmissionDocument[];
  acceptance: AcceptanceShare;
  /** Factor keys used by the run that are not marked verified. Always disclosed. */
  unverifiedFactors: string[];
  /** Open items the recipient should know about (regulatory register references). */
  openItems: string[];
}

/** What stops a package being built. Empty means ready. */
export function submissionBlockers(input: SubmissionInput): string[] {
  const out: string[] = [];
  if (!input.run) out.push("No calculation run has been recorded.");
  else if (input.run.draft_mode) out.push("The latest run was made in draft mode.");
  const blocking = input.findings.filter(isBlockingOpen).length;
  if (blocking > 0) out.push(`${blocking} block issue(s) are still open.`);
  const roles = new Set(input.signoffs.map((s) => s.role));
  if (!roles.has("lead_verifier")) out.push("The lead verifier has not signed.");
  if (!roles.has("independent_reviewer")) out.push("The independent reviewer has not signed.");
  if (input.technicalReview.status === "missing" || input.technicalReview.status === "stale" || input.technicalReview.status === "changes_requested") {
    out.push(`Technical review is ${input.technicalReview.status.replace("_", " ")}.`);
  }
  return out;
}

export interface BuiltPackage {
  bytes: Uint8Array;
  sha256: string;
  filename: string;
  manifest: Record<string, unknown>;
  includedEvidenceFiles: number;
}

function provenanceDetail(f: SubmissionFact): string {
  const p = provenanceFromColumns(f);
  return p ? describeProvenance(p).detail : "";
}

export function buildSubmissionPackage(input: SubmissionInput): BuiltPackage {
  const blockers = submissionBlockers(input);
  if (blockers.length > 0) {
    throw new SubmissionError("The package cannot be built yet.", blockers);
  }
  const run = input.run!;

  const parts: Array<{ name: string; data: string | Uint8Array; mediaType: string; title: string }> = [];
  const add = (name: string, data: string | Uint8Array, mediaType: string, title: string) =>
    parts.push({ name, data, mediaType, title });

  const facts = [...input.facts].sort((a, b) => a.field_path.localeCompare(b.field_path) || a.id.localeCompare(b.id));
  add(
    "facts.csv",
    toCsv(
      ["fact_id", "field_path", "value", "unit", "evidence_type", "evidence_detail", "document_id", "accepted_by", "accepted_at", "accept_mode"],
      facts.map((f) => [
        f.id,
        f.field_path,
        typeof f.value_json === "object" ? JSON.stringify(f.value_json) : f.value_json,
        f.unit,
        f.provenance_type ?? "document_page",
        provenanceDetail(f),
        f.document_id,
        f.accepted_by,
        f.accepted_at,
        f.accept_mode ?? "individual",
      ])
    ),
    "text/csv",
    "Accepted facts with provenance"
  );

  add(
    "calculation-run.json",
    canonicalJson({
      id: run.id,
      engine_version: run.engine_version,
      pack_id: input.engagement.pack_id,
      pack_version: run.pack_version,
      factor_set_version: run.factor_set_version,
      input_hash: run.input_hash,
      previous_run_hash: run.previous_run_hash,
      created_at: run.created_at,
      inputs: run.inputs,
      result: run.result,
      unverified_factors: [...input.unverifiedFactors].sort(),
    }),
    "application/json",
    "Calculation record"
  );

  const findings = [...input.findings].sort((a, b) => a.rule_id.localeCompare(b.rule_id) || a.id.localeCompare(b.id));
  add(
    "findings.csv",
    toCsv(
      ["rule_id", "severity", "title", "state", "clause_ref", "due_at"],
      findings.map((f) => [f.rule_id, f.severity, f.title, f.state, f.clause_ref, f.due_at ?? ""])
    ),
    "text/csv",
    "Findings and outcome"
  );

  add(
    "signoffs.csv",
    toCsv(
      ["role", "attestor_name", "report_hash", "signed_at", "statement"],
      input.signoffs.map((s) => [s.role, s.attestor_name, s.report_hash, s.created_at, s.statement])
    ),
    "text/csv",
    "Sign-offs"
  );

  const docs = [...input.documents].sort((a, b) => a.sha256.localeCompare(b.sha256));
  add(
    "evidence-index.csv",
    toCsv(
      ["sha256", "filename", "type", "bytes", "doc_type", "bundled"],
      docs.map((d) => [d.sha256, d.original_filename, d.mime_type, d.byte_size, d.doc_type, d.bytes ? "yes" : "no"])
    ),
    "text/csv",
    "Evidence index"
  );

  let included = 0;
  for (const d of docs) {
    if (!d.bytes) continue;
    if (sha256Hex(d.bytes) !== d.sha256) {
      throw new SubmissionError(`Evidence file "${d.original_filename}" does not match its recorded hash and was not bundled.`);
    }
    add(`evidence/${d.sha256.slice(0, 12)}-${sanitizeArchiveName(d.original_filename)}`, d.bytes, d.mime_type ?? "application/octet-stream", d.original_filename);
    included++;
  }

  add(
    "README.txt",
    [
      "VerifyStack submission package",
      "",
      "NOTE: The layout of this package is generic. A scheme or portal template has not been confirmed, so it is not a regulator-prescribed format.",
      "",
      `Engagement:    ${input.engagement.client_name}${input.engagement.plant_name ? `, ${input.engagement.plant_name}` : ""}`,
      `Period:        ${input.engagement.compliance_year}`,
      `Methodology:   ${input.engagement.pack_id} v${input.engagement.pack_version}`,
      `Calculation:   engine ${run.engine_version}, input hash ${run.input_hash}`,
      `Generated:     ${input.generatedAt}`,
      "",
      `Facts accepted by a person: ${input.acceptance.total} (${input.acceptance.individual} individually, ${input.acceptance.bulk} in audited bulk actions, ${(input.acceptance.bulkShare * 100).toFixed(1)}% bulk).`,
      `Technical review: ${input.technicalReview.status.replace("_", " ")}.`,
      input.unverifiedFactors.length
        ? `Unverified emission factors used: ${[...input.unverifiedFactors].sort().join(", ")}.`
        : "No unverified emission factors were used.",
      "",
      "Files are listed with SHA-256 digests in manifest.json. Verify them before relying on this package.",
      "",
      ...(input.openItems.length ? ["Open items:", ...input.openItems.map((o) => `  - ${o}`), ""] : []),
    ].join("\n"),
    "text/plain",
    "Read me first"
  );

  const manifest = {
    format: EVIDENCE_PACK_FORMAT,
    version: EVIDENCE_PACK_VERSION,
    createdAt: input.generatedAt,
    source: { system: "VerifyStack", name: "Submission package" },
    entity: {
      name: input.engagement.client_name,
      ...(input.engagement.plant_name ? { plant: input.engagement.plant_name } : {}),
      period: input.engagement.compliance_year,
    },
    files: parts.map((p) => ({
      path: p.name,
      sha256: sha256Hex(p.data),
      mediaType: p.mediaType,
      title: p.title,
    })),
    declared: [],
    package: {
      version: SUBMISSION_PACKAGE_VERSION,
      engagementId: input.engagement.id,
      packId: input.engagement.pack_id,
      packVersion: input.engagement.pack_version,
      scheme: input.engagement.scheme,
      adeetiePhase: input.engagement.adeetie_phase ?? null,
      engineVersion: run.engine_version,
      factorSetVersion: run.factor_set_version,
      runInputHash: run.input_hash,
      signoffHashes: input.signoffs.map((s) => s.report_hash),
      technicalReview: input.technicalReview,
      acceptance: input.acceptance,
      layoutUnverified: true,
    },
  };

  const manifestText = canonicalJson(manifest);
  const bytes = writeZip([{ name: "manifest.json", data: manifestText }, ...parts.map((p) => ({ name: p.name, data: p.data }))]);
  const base = sanitizeArchiveName(`${input.engagement.client_name}-${input.engagement.compliance_year}`);
  return {
    bytes,
    sha256: sha256Hex(bytes),
    filename: `submission-${base}.zip`,
    manifest,
    includedEvidenceFiles: included,
  };
}
