import { createHash } from "node:crypto";
import { NextResponse } from "next/server";
import { z } from "zod";
import { clientIp, jsonError, limitExceeded } from "@/lib/api";
import { LIMITS } from "@verifystack/backend/lib/rateLimit";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { resolveResponseLink } from "@verifystack/backend/lib/data/entityResponse";
import { IngestError, ingestEvidenceFile } from "@verifystack/backend/lib/data/ingestDocument";

/**
 * Public. The only credential is the signed, single-use response link, so this
 * route does exactly one thing: attach an answer (and any files) to the one
 * issue the link was minted for. It never reads or writes anything else.
 */

const MAX_FILES = 5;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_REQUEST_BYTES = 45 * 1024 * 1024;

const Fields = z.object({
  token: z.string().min(10).max(2000),
  name: z.string().trim().min(2, "Enter your name.").max(200),
  contact: z.string().trim().max(200).optional(),
  body: z.string().trim().min(5, "Write your response.").max(8000),
});

function refuse(error: string, status: number) {
  return NextResponse.json({ ok: false, error }, { status });
}

export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    const limited = limitExceeded(`respond:ip:${ip}`, LIMITS.entityResponsePerIp);
    if (limited) return limited;

    const declared = Number(req.headers.get("content-length") ?? 0);
    if (declared > MAX_REQUEST_BYTES) return refuse("That is too much to send at once. Attach fewer or smaller files.", 413);

    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      return refuse("The response could not be read.", 400);
    }

    const parsed = Fields.safeParse({
      token: form.get("token"),
      name: form.get("name"),
      contact: (form.get("contact") as string | null) || undefined,
      body: form.get("body"),
    });
    if (!parsed.success) {
      return refuse(parsed.error.issues[0]?.message ?? "Check the form and try again.", 400);
    }
    const fields = parsed.data;

    const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    if (files.length > MAX_FILES) return refuse(`Attach at most ${MAX_FILES} files.`, 400);
    for (const f of files) {
      if (f.size > MAX_FILE_BYTES) return refuse(`${f.name} is larger than 10 MB.`, 413);
    }

    const resolved = await resolveResponseLink(fields.token);
    if (!resolved.ok) {
      if (resolved.reason === "unavailable") return refuse("This service is not available right now.", 503);
      return refuse("This link is no longer active. Ask your verifier for a new one.", 410);
    }
    const { finding, engagement, payload } = resolved.target;

    const perLink = limitExceeded(`respond:link:${finding.id}`, LIMITS.entityResponsePerLink);
    if (perLink) return perLink;

    const admin = createServiceClient();
    if (!admin) return refuse("This service is not available right now.", 503);

    // Store files first. They are content-addressed and deduplicated, so a retry
    // after a failure further down does not duplicate anything.
    const documentIds: string[] = [];
    for (const f of files) {
      try {
        const result = await ingestEvidenceFile({
          organizationId: payload.organizationId,
          engagement,
          actorUserId: null,
          filename: f.name,
          bytes: new Uint8Array(await f.arrayBuffer()),
          source: "entity_response",
          findingId: finding.id,
          allow: ["page", "spreadsheet", "csv"],
          actorLabel: `${fields.name} (entity)`,
        });
        documentIds.push(result.document.id);
      } catch (e) {
        if (e instanceof IngestError) return refuse(`${f.name}: ${e.message}`, e.status);
        throw e;
      }
    }

    // Burn the link. The filter makes this a compare-and-set: two people (or a
    // double click) submitting at once cannot both win.
    const now = new Date().toISOString();
    const { data: claimed, error: claimErr } = await admin
      .from("findings")
      .update({ state: "responded", responded_at: now, response_nonce: null, updated_at: now })
      .eq("id", finding.id)
      .eq("organization_id", payload.organizationId)
      .eq("state", "open")
      .eq("response_nonce", payload.nonce)
      .select("id");
    if (claimErr) throw new Error(claimErr.message);
    if (!claimed || claimed.length === 0) {
      return refuse("This link is no longer active. Ask your verifier for a new one.", 410);
    }

    const { data: response, error: respErr } = await admin
      .from("issue_responses")
      .insert({
        organization_id: payload.organizationId,
        engagement_id: finding.engagement_id,
        finding_id: finding.id,
        kind: "entity",
        responder_name: fields.name,
        responder_contact: fields.contact ?? null,
        body: fields.body,
        document_ids: documentIds,
        // A hash, not the address: enough to notice one source sending many answers.
        ip_hash: createHash("sha256").update(`${finding.id}:${ip}`).digest("hex").slice(0, 32),
      })
      .select("id")
      .single();
    if (respErr) throw new Error(respErr.message);

    await auditEvent({
      organizationId: payload.organizationId,
      actorUserId: null,
      action: "finding.entity_responded",
      entityType: "finding",
      entityId: finding.id,
      payload: {
        from: "open",
        state: "responded",
        responseId: response.id,
        actor: `${fields.name} (entity, via response link)`,
        documents: documentIds.length,
      },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    return jsonError(e);
  }
}
