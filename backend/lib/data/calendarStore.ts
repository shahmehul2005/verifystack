import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database, Json } from "@verifystack/backend/lib/supabase/types";
import {
  CEMENT_STREAMS,
  CATEGORY_METADATA,
  getFiscalMonths,
  getStreamDefinition,
  normalizeStreamValue,
  computeCellVariance,
  computeAnnualRollup,
  matchDateToMonthKey,
  type SourceType,
  type CalendarGridData,
  type StreamCalendarRow,
  type CalendarReading,
  type MonthCell,
  type CalendarGridCategory,
} from "@verifystack/backend/domain/calendar/index";

export function inferSourceType(
  doc?: { original_filename?: string | null; slot?: string | null; doc_type?: string | null } | null,
  fallbackMethod?: string
): SourceType {
  if (!doc) {
    if (fallbackMethod === "regex_propose" || fallbackMethod === "manual_entry") {
      return "corroboration";
    }
    return "sourcing";
  }

  const name = (doc.original_filename ?? "").toLowerCase();
  const slot = (doc.slot ?? "").toLowerCase();
  const type = (doc.doc_type ?? "").toLowerCase();

  // Pro forma return / declared figures
  if (
    slot === "proforma_workbook" ||
    slot === "form1" ||
    name.includes("proforma") ||
    name.includes("pro-forma") ||
    name.includes("form1") ||
    name.includes("form-1") ||
    name.includes("form_1") ||
    name.includes("form-sb")
  ) {
    return "proforma";
  }

  // Internal operational corroboration (ERP, SCADA, daily production, monthly registers, internal lab logs)
  if (
    name.includes("scada") ||
    name.includes("erp") ||
    name.includes("daily") ||
    name.includes("register") ||
    name.includes("log") ||
    name.includes("summary") ||
    slot === "petcoke_log" ||
    slot === "fuel_lab_log" ||
    type === "production_log" ||
    type === "fuel_lab_log"
  ) {
    return "corroboration";
  }

  // Primary sourcing (utility bills, invoices, GRN, weighbridge, delivery slips, NABL external certs)
  return "sourcing";
}

/**
 * Loads the complete 12-Month Calendar Grid for an engagement.
 * Binds primary sourcing, corroboration, and pro forma figures side-by-side.
 */
export async function loadCalendarGridForEngagement(
  supabase: SupabaseClient<Database>,
  engagementId: string,
  organizationId: string
): Promise<CalendarGridData> {
  // 1. Fetch engagement metadata for compliance year
  const { data: eng } = await supabase
    .from("engagements")
    .select("id, compliance_year, pack_id")
    .eq("id", engagementId)
    .eq("organization_id", organizationId)
    .maybeSingle();

  const complianceYear = eng?.compliance_year ?? "FY2023-24";
  const months = getFiscalMonths(complianceYear);

  // 2. Fetch all documents to link names and infer source types
  const { data: docRows } = await supabase
    .from("documents")
    .select("id, original_filename, slot, doc_type")
    .eq("engagement_id", engagementId)
    .eq("organization_id", organizationId);

  const docMap = new Map((docRows ?? []).map((d) => [d.id, d]));

  // 3. Fetch evidence values from canonical_evidence_values
  const { data: cevRows } = await supabase
    .from("canonical_evidence_values")
    .select("*")
    .eq("engagement_id", engagementId)
    .eq("organization_id", organizationId)
    .not("state", "in", '("rejected","withdrawn")')
    .order("period_start", { ascending: true });

  // 4. Map raw CEVs into CalendarReadings
  const readings: CalendarReading[] = [];

  for (const row of cevRows ?? []) {
    const rawKey = row.canonical_key;
    const parts = rawKey.split("#");
    const baseKey = parts[0];
    const keySourceType = parts[1] as SourceType | undefined;

    const streamDef = getStreamDefinition(baseKey);
    if (!streamDef) continue; // Skip non-cement streams if any

    const doc = row.document_id ? docMap.get(row.document_id) : null;

    let sourceType: SourceType = keySourceType ?? "sourcing";
    if (!keySourceType) {
      if (row.registry_version?.startsWith("source_type:")) {
        sourceType = row.registry_version.replace("source_type:", "") as SourceType;
      } else {
        sourceType = inferSourceType(doc, row.extraction_method);
      }
    }

    // Determine monthKey: either from period_start, period_end, or document name
    let monthKey: string | null = null;
    if (row.period_kind === "annual") {
      monthKey = "annual";
    } else if (row.period_start) {
      monthKey = matchDateToMonthKey(row.period_start);
    } else if (row.period_end) {
      monthKey = matchDateToMonthKey(row.period_end);
    }

    if (!monthKey && doc?.original_filename) {
      monthKey = matchDateToMonthKey(doc.original_filename);
    }

    // Default to first month if totally unknown and not annual
    if (!monthKey) {
      monthKey = row.period_kind === "annual" ? "annual" : months[0].key;
    }

    const rawVal =
      row.state === "corrected" && row.correction_numeric !== null
        ? row.correction_numeric
        : (row.value_numeric ?? 0);

    const rawUnit =
      row.state === "corrected" && row.correction_unit
        ? row.correction_unit
        : (row.value_unit ?? streamDef.standardUnit);

    const standardVal =
      row.standard_value ??
      normalizeStreamValue(rawVal, rawUnit, streamDef.standardUnit);

    readings.push({
      id: row.id,
      engagementId,
      streamKey: streamDef.key,
      monthKey,
      startDate: row.period_start ?? `${monthKey}-01`,
      endDate: row.period_end ?? `${monthKey}-28`,
      sourceType,
      valueNumeric: rawVal,
      unit: rawUnit,
      standardValue: standardVal,
      standardUnit: streamDef.standardUnit,
      documentId: row.document_id,
      documentName: doc?.original_filename ?? null,
      provenancePage: row.provenance_page,
      provenanceBbox: row.provenance_bbox as { x: number; y: number; width: number; height: number } | null,
      provenanceSourceText: row.provenance_source_text,
      inputHash: row.input_hash,
      state: (row.state as "suggested" | "accepted" | "corrected") ?? "suggested",
      reviewedAt: row.reviewed_at,
      reviewedBy: row.reviewed_by,
    });
  }

  // 5. Build weights lookup for weighted averages (e.g. coal_quantity weights for coal_gcv)
  const monthlyWeightsByStream = new Map<string, Map<string, number>>();
  for (const r of readings) {
    if (r.monthKey !== "annual") {
      let m = monthlyWeightsByStream.get(r.streamKey);
      if (!m) {
        m = new Map();
        monthlyWeightsByStream.set(r.streamKey, m);
      }
      m.set(r.monthKey, r.standardValue);
    }
  }

  // 6. Build Stream Rows
  const streamRows: StreamCalendarRow[] = [];
  const totalReadingsCount = readings.length;
  let complete12MonthStreams = 0;
  let varianceAlertsCount = 0;
  let activeStreamsCount = 0;

  for (const stream of CEMENT_STREAMS) {
    const streamReadings = readings.filter((r) => r.streamKey === stream.key);
    const hasAnyReadings = streamReadings.length > 0;
    if (hasAnyReadings) activeStreamsCount++;

    const proformaAnnual = streamReadings.find(
      (r) => r.monthKey === "annual" && r.sourceType === "proforma"
    );

    const monthsCells: MonthCell[] = months.map((m) => {
      const monthReadings = streamReadings.filter((r) => r.monthKey === m.key);
      const sourcing = monthReadings.find((r) => r.sourceType === "sourcing");
      const corroboration = monthReadings.find((r) => r.sourceType === "corroboration");
      const proforma = monthReadings.find((r) => r.sourceType === "proforma");

      const { variancePercent, hasVarianceAlert } = computeCellVariance({
        sourcing,
        corroboration,
        proforma,
      });

      if (hasVarianceAlert) varianceAlertsCount++;

      const isComplete = Boolean(sourcing || corroboration || proforma);

      return {
        monthKey: m.key,
        label: m.label,
        startDate: m.startDate,
        endDate: m.endDate,
        sourcing,
        corroboration,
        proforma,
        variancePercent,
        hasVarianceAlert,
        isComplete,
      };
    });

    const weightMap = stream.weightStreamKey
      ? monthlyWeightsByStream.get(stream.weightStreamKey)
      : undefined;

    const annualRollup = computeAnnualRollup(stream, monthsCells, proformaAnnual, weightMap);

    if (annualRollup.isComplete) complete12MonthStreams++;

    streamRows.push({
      stream,
      months: monthsCells,
      annualRollup,
    });
  }

  // 7. Group into categories
  const categories: CalendarGridCategory[] = (
    Object.keys(CATEGORY_METADATA) as (keyof typeof CATEGORY_METADATA)[]
  ).map((catKey) => {
    const meta = CATEGORY_METADATA[catKey];
    const rows = streamRows.filter((r) => r.stream.category === catKey);
    return {
      category: catKey,
      label: meta.label,
      scope: meta.scope,
      rows,
    };
  });

  return {
    engagementId,
    complianceYear,
    months,
    categories,
    summary: {
      totalStreams: CEMENT_STREAMS.length,
      activeStreamsCount,
      complete12MonthStreams,
      totalReadingsCount,
      varianceAlertsCount,
    },
  };
}

/**
 * Saves a new Calendar Reading into canonical_evidence_values.
 */
export async function saveCalendarReading(
  supabase: SupabaseClient<Database>,
  params: {
    engagementId: string;
    organizationId: string;
    streamKey: string;
    monthKey: string; // "2023-04" or "annual"
    sourceType: SourceType;
    valueNumeric: number;
    unit?: string | null;
    documentId?: string | null;
    provenancePage?: number | null;
    provenanceBbox?: { x: number; y: number; width: number; height: number } | null;
    provenanceSourceText?: string | null;
    reviewedBy?: string | null;
  }
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const streamDef = getStreamDefinition(params.streamKey);
  if (!streamDef) {
    return { ok: false, error: `Unknown stream key: ${params.streamKey}` };
  }

  const unit = params.unit || streamDef.standardUnit;
  const standardVal = normalizeStreamValue(params.valueNumeric, unit, streamDef.standardUnit);

  const periodKind: "monthly" | "annual" = params.monthKey === "annual" ? "annual" : "monthly";
  let startDate = `${params.monthKey}-01`;
  let endDate = `${params.monthKey}-28`;

  if (params.monthKey === "annual") {
    startDate = "2023-04-01";
    endDate = "2024-03-31";
  }

  // Generate hashes
  const inputHash = createHash("sha256")
    .update(`${params.documentId ?? "manual"}|${params.provenancePage ?? 1}|${params.provenanceSourceText ?? ""}`)
    .digest("hex");
  const outputHash = createHash("sha256")
    .update(`${params.streamKey}|${params.monthKey}|${params.sourceType}|${standardVal}|${streamDef.standardUnit}`)
    .digest("hex");

  const canonicalKey = `${streamDef.key}#${params.sourceType}`;
  const registryVersion = `source_type:${params.sourceType}`;

  const { data, error } = await supabase
    .from("canonical_evidence_values")
    .insert({
      organization_id: params.organizationId,
      engagement_id: params.engagementId,
      canonical_key: canonicalKey,
      registry_version: registryVersion,
      extraction_method: params.documentId ? "ai_extraction" : "manual_entry",
      document_id: params.documentId ?? null,
      period_kind: periodKind,
      period_start: startDate,
      period_end: endDate,
      value_numeric: params.valueNumeric,
      value_unit: unit,
      value_as_stated: String(params.valueNumeric),
      standard_value: standardVal,
      standard_unit: streamDef.standardUnit,
      provenance_page: params.provenancePage ?? 1,
      provenance_bbox: (params.provenanceBbox as unknown as Json) ?? null,
      provenance_source_text: params.provenanceSourceText ?? `Manual reading for ${streamDef.label}`,
      input_hash: inputHash,
      output_hash: outputHash,
      state: "accepted",
      reviewed_by: params.reviewedBy ?? null,
      reviewed_at: new Date().toISOString(),
    })
    .select("id")
    .single();

  if (error) {
    return { ok: false, error: error.message };
  }

  return { ok: true, id: data.id };
}

/**
 * Commits verified Annual Roll-Ups to the facts table and/or canonical_evidence_values
 * so calculation runs can consume them deterministically with zero multiple-value conflicts.
 */
export async function commitAnnualRollupsToCalculation(
  supabase: SupabaseClient<Database>,
  engagementId: string,
  organizationId: string
): Promise<{ committed: number; rollups: Record<string, number> }> {
  const grid = await loadCalendarGridForEngagement(supabase, engagementId, organizationId);
  const rollups: Record<string, number> = {};
  let committed = 0;

  for (const cat of grid.categories) {
    for (const row of cat.rows) {
      const annualVal = row.annualRollup.value;
      if (annualVal !== null && Number.isFinite(annualVal)) {
        const stream = row.stream;
        rollups[stream.calcBindingPath] = annualVal;

        // Check if an accepted annual CEV already exists for this stream
        const annualKey = `${stream.key}#${row.annualRollup.sourceType}`;
        const { data: existingAnnual } = await supabase
          .from("canonical_evidence_values")
          .select("id")
          .eq("engagement_id", engagementId)
          .eq("organization_id", organizationId)
          .eq("canonical_key", annualKey)
          .eq("period_kind", "annual")
          .maybeSingle();

        const aggMethod =
          stream.aggregation === "latest" ? "point_in_time" : stream.aggregation;

        if (existingAnnual) {
          await (supabase.from("canonical_evidence_values") as unknown as { update: (vals: Record<string, unknown>) => { eq: (col: string, val: string) => Promise<unknown> } })
            .update({
              value_numeric: annualVal,
              standard_value: annualVal,
              standard_unit: stream.standardUnit,
              aggregation_method: aggMethod,
              aggregated_child_count: row.annualRollup.completedMonthsCount,
              updated_at: new Date().toISOString(),
            })
            .eq("id", existingAnnual.id);
        } else {
          await supabase.from("canonical_evidence_values").insert({
            organization_id: organizationId,
            engagement_id: engagementId,
            canonical_key: annualKey,
            registry_version: `source_type:${row.annualRollup.sourceType}`,
            extraction_method: "workbook_reader",
            period_kind: "annual",
            period_start: "2023-04-01",
            period_end: "2024-03-31",
            value_numeric: annualVal,
            value_unit: stream.standardUnit,
            value_as_stated: String(annualVal),
            standard_value: annualVal,
            standard_unit: stream.standardUnit,
            provenance_page: 1,
            provenance_source_text: `Verified 12-month annual roll-up for ${stream.label}`,
            state: "accepted",
            aggregation_method: aggMethod,
            aggregated_child_count: row.annualRollup.completedMonthsCount,
          });
        }

        // Also update or insert in public.facts by field_path so legacy calculation runners bind cleanly
        const { data: existingFact } = await supabase
          .from("facts")
          .select("id")
          .eq("engagement_id", engagementId)
          .eq("organization_id", organizationId)
          .eq("field_path", stream.calcBindingPath)
          .maybeSingle();

        if (existingFact) {
          await (supabase.from("facts") as unknown as { update: (vals: Record<string, unknown>) => { eq: (col: string, val: string) => Promise<unknown> } })
            .update({
              value_json: annualVal,
              unit: stream.standardUnit,
              canonical_key: stream.key,
              period_start: "2023-04-01",
              period_end: "2024-03-31",
              period_status: "known",
              provenance_type: "document_page",
              source_text: `Verified annual roll-up for ${stream.label}`,
            })
            .eq("id", existingFact.id);
        } else {
          await supabase.from("facts").insert({
            organization_id: organizationId,
            engagement_id: engagementId,
            field_path: stream.calcBindingPath,
            value_json: annualVal,
            unit: stream.standardUnit,
            canonical_key: stream.key,
            period_start: "2023-04-01",
            period_end: "2024-03-31",
            period_status: "known",
            provenance_type: "document_page",
            source_text: `Verified annual roll-up for ${stream.label}`,
          });
        }

        committed++;
      }
    }
  }

  return { committed, rollups };
}
