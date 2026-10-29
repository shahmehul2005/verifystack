import { notFound } from "next/navigation";
import { ConfigureSupabase, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { getSession, getEngagement } from "@/lib/session";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { deskReviewFor, readWorkbooks, runDeskReview, type DeskOutcome, type DeskWorkbook, type Readings } from "@verifystack/backend/domain/deskreview";
import { parseXlsx } from "@verifystack/backend/domain/intake/xlsx";
import { readProforma, type ProformaReading } from "@verifystack/backend/domain/proforma/reader";
import { loadPack } from "@verifystack/backend/domain/packs";
import { XLSX_MIME } from "@verifystack/backend/lib/evidence";
import { DeskReviewStudio } from "./desk-review-client";

export const metadata = { title: "Desk review" };

export default async function DeskReviewPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "review.decide")) {
    return <ForbiddenState body="Desk review is for verifiers and the lead verifier." />;
  }
  const canDecide = true;
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();
  const def = deskReviewFor(engagement.pack_id);
  if (!def) notFound();

  const supabase = createServiceClient() ?? (await createServerSupabase());
  const [{ data: review }, { data: readings }, { data: docs }] = await Promise.all([
    supabase!
      .from("desk_reviews")
      .select("id, results, notes, created_at")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabase!.from("desk_readings").select("key, value, document_id, page").eq("engagement_id", id).eq("organization_id", session.organizationId),
    supabase!.from("documents").select("id, original_filename, slot, storage_path, mime_type").eq("engagement_id", id).eq("organization_id", session.organizationId),
  ]);

  let results = ((review?.results ?? []) as unknown as DeskOutcome[]) ?? [];
  let notes = ((review?.notes ?? []) as unknown as string[]) ?? [];

  // Attempt to read the pro-forma workbook and evidence workbooks if present in evidence slots
  const proformaDoc = docs?.find((d) => d.slot === "proforma_workbook");
  let proformaReading: ProformaReading | null = null;
  const proformaFileName = proformaDoc?.original_filename ?? null;

  const xlsxDocs = (docs ?? []).filter((d) => d.mime_type === XLSX_MIME && d.slot && d.storage_path);
  let workbookReadings: Readings = {};

  if (xlsxDocs.length > 0) {
    try {
      const files: DeskWorkbook[] = (
        await Promise.all(
          xlsxDocs.map(async (d): Promise<DeskWorkbook | null> => {
            const { data: blob } = await supabase!.storage.from("evidence").download(d.storage_path);
            if (!blob) return null;
            return { slot: d.slot as string, name: d.original_filename, bytes: new Uint8Array(await blob.arrayBuffer()) };
          })
        )
      ).filter((f): f is DeskWorkbook => f !== null);

      const proformaFile = files.find((f) => f.slot === "proforma_workbook");
      if (proformaFile) {
        const wb = parseXlsx(proformaFile.bytes);
        proformaReading = readProforma(wb, def.proformaCells);
      }

      const wbResult = readWorkbooks(def, files, loadPack(engagement.pack_id).proforma_inputs ?? []);
      workbookReadings = wbResult.readings;
      if (notes.length === 0) notes = wbResult.notes;
    } catch {
      // Advisory read only
    }
  }

  // If no desk review run has been recorded in the database yet, run live evaluation so the auditor sees all checks!
  if (results.length === 0) {
    const allReadings: Readings = { ...workbookReadings };
    for (const r of readings ?? []) {
      allReadings[r.key] = Number(r.value);
    }
    results = runDeskReview(def, allReadings);
  }

  return (
    <>
      <PageHeader
        kicker="Verification"
        title="Desk review"
        description="Cross-checks between primary evidence and sector pro-forma inputs. Code recomputes formulas deterministically; AI proposes readings with mandatory auditor sign-off."
      />

      <DeskReviewStudio
        engagementId={id}
        packId={engagement.pack_id}
        rules={def.rules}
        manualSpecs={def.manual}
        initialResults={results}
        initialNotes={notes}
        savedReadings={(readings ?? []).map((r) => ({
          key: r.key,
          value: Number(r.value),
          documentId: r.document_id,
          page: r.page,
        }))}
        docs={(docs ?? []).map((d) => ({
          id: d.id,
          name: d.original_filename,
          slot: d.slot,
        }))}
        proforma={proformaReading}
        proformaFileName={proformaFileName}
        lastRunAt={review?.created_at ?? null}
        canDecide={canDecide}
      />
    </>
  );
}
