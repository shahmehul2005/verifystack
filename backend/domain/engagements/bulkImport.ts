/**
 * Bulk engagement import (DFD 1.3).
 *
 * An agency or firm brings a portfolio as a spreadsheet. This module turns
 * rows into validated engagement-create inputs and says, per row, what is wrong
 * with the ones that are not. It performs no writes: the route runs it as a dry
 * run first and commits only when every row the user kept is valid.
 *
 * Rows are held to the same schema as the setup wizard. Headers are matched by
 * alias so a registry exported from another tool still maps. Anything the
 * importer cannot place is reported, never guessed.
 */

import { loadPack, canStartWork } from "../packs";
import { EngagementCreateSchema, type EngagementCreate } from "./schema";

export const MAX_IMPORT_ROWS = 200;

export class BulkImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BulkImportError";
  }
}

/** Canonical column -> accepted header spellings (compared after normalising). */
export const COLUMN_ALIASES: Record<string, string[]> = {
  packId: ["packid", "pack", "packcode", "methodologypack"],
  clientName: ["clientname", "client", "entity", "entityname", "company", "companyname", "unitname"],
  plantName: ["plantname", "plant", "site", "sitename", "facility", "location"],
  complianceYear: ["complianceyear", "year", "period", "fy", "financialyear", "reportingperiod"],
  geiTarget: ["geitarget", "target", "geitargettco2eperunit"],
  adeetieCluster: ["adeetiecluster", "cluster", "clustername"],
  adeetieState: ["adeetiestate", "state"],
  enterpriseCategory: ["enterprisecategory", "category", "msmecategory", "enterprisetype"],
  udyamRegistrationNo: ["udyamregistrationno", "udyam", "udyamno", "udyamregistrationnumber", "udyamregistration"],
  loanAmountInr: ["loanamountinr", "loanamount", "loan", "loaninr"],
  projectCostInr: ["projectcostinr", "projectcost", "cost", "costinr"],
  sanctionedInterestRatePct: ["sanctionedinterestratepct", "interestrate", "interest", "sanctionedinterestrate"],
  claimedDistanceToClusterKm: ["claimeddistancetoclusterkm", "distancetocluster", "distancekm", "clusterdistancekm"],
};

const NUMERIC: ReadonlySet<string> = new Set([
  "geiTarget",
  "loanAmountInr",
  "projectCostInr",
  "sanctionedInterestRatePct",
  "claimedDistanceToClusterKm",
]);

function norm(h: string): string {
  return h.toLowerCase().replace(/[^a-z0-9]/g, "");
}

export interface HeaderMapping {
  /** header index -> canonical column */
  byIndex: Map<number, string>;
  unmapped: string[];
  missingRequired: string[];
}

export function mapHeaders(header: string[]): HeaderMapping {
  const byIndex = new Map<number, string>();
  const unmapped: string[] = [];
  const lookup = new Map<string, string>();
  for (const [col, aliases] of Object.entries(COLUMN_ALIASES)) {
    lookup.set(norm(col), col);
    for (const a of aliases) lookup.set(a, col);
  }
  const used = new Set<string>();
  header.forEach((h, i) => {
    const col = lookup.get(norm(h));
    if (col && !used.has(col)) {
      byIndex.set(i, col);
      used.add(col);
    } else if (h.trim() !== "") {
      unmapped.push(h.trim());
    }
  });
  const missingRequired = ["packId", "clientName", "complianceYear"].filter((c) => !used.has(c));
  return { byIndex, unmapped, missingRequired };
}

function parseCell(col: string, raw: string): unknown {
  const v = raw.trim();
  if (v === "") return undefined;
  if (NUMERIC.has(col)) {
    const n = Number(v.replace(/[,₹\s]/g, "").replace(/%$/, ""));
    return Number.isFinite(n) ? n : v; // leave junk as text so validation reports it
  }
  return v;
}

export interface RowResult {
  /** 1-based row number in the file, counting the header as row 1. */
  row: number;
  ok: boolean;
  input?: EngagementCreate;
  errors: string[];
  warnings: string[];
}

export interface BulkPreview {
  headerProblems: string[];
  unmappedHeaders: string[];
  rows: RowResult[];
  validCount: number;
  invalidCount: number;
}

export function previewBulkImport(table: string[][]): BulkPreview {
  if (table.length < 2) {
    throw new BulkImportError("The file needs a header row and at least one engagement.");
  }
  if (table.length - 1 > MAX_IMPORT_ROWS) {
    throw new BulkImportError(`Import at most ${MAX_IMPORT_ROWS} engagements at a time. This file has ${table.length - 1}.`);
  }
  const mapping = mapHeaders(table[0]!);
  const headerProblems = mapping.missingRequired.map((c) => `Missing column: ${c}.`);
  if (headerProblems.length > 0) {
    return { headerProblems, unmappedHeaders: mapping.unmapped, rows: [], validCount: 0, invalidCount: 0 };
  }

  const seen = new Map<string, number>();
  const rows: RowResult[] = [];
  for (let r = 1; r < table.length; r++) {
    const cells = table[r]!;
    if (cells.every((c) => c.trim() === "")) continue;
    const candidate: Record<string, unknown> = {};
    for (const [i, col] of mapping.byIndex) {
      const v = parseCell(col, cells[i] ?? "");
      if (v !== undefined) candidate[col] = v;
    }
    const errors: string[] = [];
    const warnings: string[] = [];
    const parsed = EngagementCreateSchema.safeParse(candidate);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        errors.push(`${issue.path.join(".") || "row"}: ${issue.message}`);
      }
    }
    let input: EngagementCreate | undefined = parsed.success ? parsed.data : undefined;

    if (input) {
      try {
        const pack = loadPack(input.packId);
        if (pack.structure_only) errors.push(`packId: ${input.packId} is structure only and cannot be started.`);
        else if (!canStartWork(pack)) errors.push(`packId: ${input.packId} is not runnable yet.`);
        if (pack.scheme !== "ADEETIE") {
          const adeetieOnly = ["adeetieCluster", "adeetieState", "enterpriseCategory", "udyamRegistrationNo", "loanAmountInr", "projectCostInr", "sanctionedInterestRatePct"] as const;
          const extras = adeetieOnly.filter((k) => input![k] !== undefined && input![k] !== null);
          if (extras.length > 0) warnings.push(`${extras.join(", ")} apply to ADEETIE only and will be ignored for ${pack.scheme}.`);
        }
      } catch {
        errors.push(`packId: unknown pack "${input.packId}".`);
      }
      const key = [input.packId, input.clientName.toLowerCase(), (input.plantName ?? "").toLowerCase(), input.complianceYear].join("|");
      const first = seen.get(key);
      if (first !== undefined) errors.push(`Duplicates row ${first} (same pack, client, plant and year).`);
      else seen.set(key, r + 1);
    }
    if (errors.length > 0) input = undefined;
    rows.push({ row: r + 1, ok: errors.length === 0, input, errors, warnings });
  }
  const validCount = rows.filter((x) => x.ok).length;
  return {
    headerProblems: [],
    unmappedHeaders: mapping.unmapped,
    rows,
    validCount,
    invalidCount: rows.length - validCount,
  };
}

/** A sample file for the import page, so users do not have to guess the columns. */
export const IMPORT_TEMPLATE_CSV =
  "packId,clientName,plantName,complianceYear,geiTarget,adeetieCluster,adeetieState,enterpriseCategory,udyamRegistrationNo,loanAmountInr,projectCostInr,sanctionedInterestRatePct\r\n" +
  "CCTS-CEMENT-v1,Example Cement Ltd,Unit 1,FY2024-25,0.85,,,,,,,\r\n";
