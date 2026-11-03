import "server-only";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { loadTechnicalReview } from "@verifystack/backend/lib/data/technicalReview";
import { acceptanceShare } from "@verifystack/backend/domain/triage/risk";
import { signoffsForPass } from "@verifystack/backend/domain/adeetie/lifecycle";
import { collectUnverifiedFactors } from "@verifystack/backend/domain/submission/factors";
import type {
  SubmissionDocument,
  SubmissionInput,
} from "@verifystack/backend/domain/submission/package";
import type { IssueSeverity, IssueState } from "@verifystack/backend/domain/issues/lifecycle";
import type { AdeetiePhase, Tables } from "@verifystack/backend/lib/supabase/types";

/** Beyond this the package indexes evidence instead of bundling it, and says so. */
export const MAX_BUNDLED_BYTES = 120 * 1024 * 1024;

/** Open items every package carries. Detail lives in docs/domain/regulatory-register.md. */
export const PACKAGE_OPEN_ITEMS = [
  "The package layout is generic: no scheme or portal submission template has been supplied.",
  "Whether this scheme requires an independent technical review is not confirmed in the regulatory register.",
] as const;

export interface LoadedSubmission {
  input: SubmissionInput;
  /** Files that were indexed but not bundled because of the size cap. */
  notBundled: number;
}

export async function loadSubmissionInput(
  organizationId: string,
  engagement: Tables<"engagements">,
  options: { includeBytes: boolean }
): Promise<LoadedSubmission> {
  const supabase = createServiceClient() ?? (await createServerSupabase());
  if (!supabase) throw new Error("Supabase is not configured");

  const [{ data: facts }, { data: runs }, { data: findings }, { data: signoffs }, { data: docs }, review] =
    await Promise.all([
      supabase
        .from("facts")
        .select("*")
        .eq("engagement_id", engagement.id)
        .eq("organization_id", organizationId),
      supabase
        .from("calculation_runs")
        .select("*")
        .eq("engagement_id", engagement.id)
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(1),
      supabase
        .from("findings")
        .select("id, rule_id, severity, title, state, clause_ref, due_at")
        .eq("engagement_id", engagement.id)
        .eq("organization_id", organizationId),
      supabase
        .from("signoffs")
        .select("*")
        .eq("engagement_id", engagement.id)
        .eq("organization_id", organizationId),
      supabase
        .from("documents")
        .select("*")
        .eq("engagement_id", engagement.id)
        .eq("organization_id", organizationId),
      loadTechnicalReview(organizationId, engagement),
    ]);

  const run = runs?.[0] ?? null;
  const passSignoffs =
    engagement.scheme === "ADEETIE"
      ? signoffsForPass(signoffs ?? [], engagement.adeetie_phase as AdeetiePhase | null)
      : (signoffs ?? []);

  let bundled = 0;
  let notBundled = 0;
  const documents: SubmissionDocument[] = [];
  for (const d of [...(docs ?? [])].sort((a, b) => a.sha256.localeCompare(b.sha256))) {
    const entry: SubmissionDocument = {
      id: d.id,
      sha256: d.sha256,
      original_filename: d.original_filename,
      mime_type: d.mime_type,
      byte_size: d.byte_size,
      doc_type: d.doc_type,
    };
    if (options.includeBytes) {
      if (bundled + d.byte_size <= MAX_BUNDLED_BYTES) {
        const { data: blob, error } = await supabase.storage.from("evidence").download(d.storage_path);
        if (error || !blob) throw new Error(`Evidence file "${d.original_filename}" could not be read from storage.`);
        entry.bytes = new Uint8Array(await blob.arrayBuffer());
        bundled += d.byte_size;
      } else {
        notBundled++;
      }
    }
    documents.push(entry);
  }

  const latestReview = review.state.latest;
  const openItems: string[] = [...PACKAGE_OPEN_ITEMS];
  if (notBundled > 0) {
    openItems.push(`${notBundled} evidence file(s) are listed with their hashes but not bundled because of the size cap.`);
  }

  return {
    notBundled,
    input: {
      generatedAt: new Date().toISOString(),
      engagement: {
        id: engagement.id,
        client_name: engagement.client_name,
        plant_name: engagement.plant_name,
        compliance_year: engagement.compliance_year,
        pack_id: engagement.pack_id,
        pack_version: engagement.pack_version,
        scheme: engagement.scheme,
        status: engagement.status,
        adeetie_phase: engagement.adeetie_phase,
      },
      facts: (facts ?? []).map((f) => ({
        id: f.id,
        field_path: f.field_path,
        value_json: f.value_json,
        unit: f.unit,
        provenance_type: f.provenance_type,
        provenance: f.provenance,
        document_id: f.document_id,
        page: f.page,
        bbox: f.bbox,
        source_text: f.source_text,
        accepted_by: f.accepted_by,
        accepted_at: f.accepted_at,
        accept_mode: f.accept_mode,
      })),
      run: run
        ? {
            id: run.id,
            engine_version: run.engine_version,
            pack_version: run.pack_version,
            factor_set_version: run.factor_set_version,
            input_hash: run.input_hash,
            previous_run_hash: run.previous_run_hash,
            draft_mode: run.draft_mode,
            inputs: run.inputs,
            result: run.result,
            created_at: run.created_at,
          }
        : null,
      findings: (findings ?? []).map((f) => ({
        id: f.id,
        rule_id: f.rule_id,
        severity: f.severity as IssueSeverity,
        title: f.title,
        state: f.state as IssueState,
        clause_ref: f.clause_ref,
        due_at: f.due_at,
      })),
      signoffs: passSignoffs.map((s) => ({
        role: s.role,
        attestor_name: s.attestor_name,
        report_hash: s.report_hash,
        statement: s.statement,
        created_at: s.created_at,
      })),
      technicalReview: {
        status: review.state.status,
        reviewer: latestReview ? review.reviews.find((r) => r.id === latestReview.id)?.reviewer_name ?? null : null,
        at: latestReview?.created_at ?? null,
      },
      documents,
      acceptance: acceptanceShare(facts ?? []),
      unverifiedFactors: run ? collectUnverifiedFactors(run.result) : [],
      openItems,
    },
  };
}
