import { requireSession, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";

/**
 * Same-origin stream of evidence bytes so PDF.js can load the page
 * without a cross-origin signed-URL hop.
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const session = await requireSession();
    const organizationId = assertOrgId(session.organizationId);
    const { id } = await params;
    const supabase = createServiceClient() ?? (await createServerSupabase());
    if (!supabase) {
      return Response.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }
    const { data: doc } = await supabase
      .from("documents")
      .select("*")
      .eq("id", id)
      .eq("organization_id", organizationId)
      .single();
    if (!doc) {
      return Response.json({ ok: false, error: "Not found" }, { status: 404 });
    }

    const admin = createServiceClient() ?? supabase;
    const { data, error } = await admin.storage.from("evidence").download(doc.storage_path);
    if (error || !data) {
      throw new Error(error?.message ?? "Storage object missing");
    }

    return new Response(data, {
      headers: {
        "Content-Type": doc.mime_type || "application/octet-stream",
        "Cache-Control": "private, max-age=60",
        "Content-Disposition": `inline; filename="${doc.original_filename.replace(/"/g, "")}"`,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
