import { NextResponse } from "next/server";
import { z } from "zod";
import { requireRole, assertOrgId } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { auditEvent } from "@verifystack/backend/lib/auth/auditEvent";
import {
  applyVerifications,
  buildFactorSet,
  FactorVerificationError,
  type FactorRecord,
} from "@verifystack/backend/domain/factors";

/**
 * `factor_verifications` and `factor_verification_state` arrive with migration
 * 0004 and are not described by the hand-written Database types in
 * backend/lib/supabase/types.ts, which this worker must not edit. The two writes
 * therefore go through a minimal structural view of the client rather than an
 * `any` escape hatch.
 */
interface LooseResult<T> {
  data: T | null;
  error: { message: string } | null;
}
interface LooseDb {
  from(table: string): {
    insert(values: Record<string, unknown>): {
      select(columns: string): { single(): Promise<LooseResult<{ id: string }>> };
    };
    upsert(
      values: Record<string, unknown>,
      options?: { onConflict?: string }
    ): PromiseLike<LooseResult<unknown>>;
  };
}

const Body = z.object({
  factorId: z.string().min(1),
  vintage: z.string().min(1),
  citedSource: z.string(),
  correctedValue: z.number().nullable().optional(),
});

export async function POST(req: Request) {
  try {
    const session = await requireRole(["lead_verifier", "firm_admin"], undefined);
    const organizationId = assertOrgId(session.organizationId);
    const parsed = Body.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }

    const baseSet = buildFactorSet();
    const existing = [...baseSet.records.values()].find(
      (r) => r.id === parsed.data.factorId && r.vintage === parsed.data.vintage
    );

    const verifiedAt = new Date().toISOString();
    const nextVersion = `${baseSet.version}+${parsed.data.factorId}@${parsed.data.vintage}`;

    // The domain layer owns what counts as a citation: empty, trivial, or still
    // carrying a TO VERIFY marker is refused here, before anything is written.
    let updated: FactorRecord | undefined;
    try {
      const nextSet = applyVerifications(
        baseSet,
        [
          {
            factorId: parsed.data.factorId,
            vintage: parsed.data.vintage,
            citedSource: parsed.data.citedSource,
            ...(parsed.data.correctedValue != null
              ? { correctedValue: parsed.data.correctedValue }
              : {}),
            verifiedBy: session.user.id,
            verifiedAt,
          },
        ],
        nextVersion
      );
      updated = [...nextSet.records.values()].find(
        (r) => r.id === parsed.data.factorId && r.vintage === parsed.data.vintage
      );
    } catch (e) {
      if (e instanceof FactorVerificationError) {
        return NextResponse.json({ ok: false, error: e.message }, { status: 422 });
      }
      throw e;
    }

    const supabase = await createServerSupabase();
    if (!supabase) {
      return NextResponse.json({ ok: false, error: "Supabase is not configured" }, { status: 503 });
    }
    const db = supabase as unknown as LooseDb;

    const { data: logRow, error: logError } = await db
      .from("factor_verifications")
      .insert({
        organization_id: organizationId,
        factor_id: parsed.data.factorId,
        vintage: parsed.data.vintage,
        cited_source: parsed.data.citedSource.trim(),
        corrected_value: parsed.data.correctedValue ?? null,
        previous_value: existing?.value ?? null,
        verified_by: session.user.id,
        verified_at: verifiedAt,
      })
      .select("id")
      .single();
    if (logError) throw new Error(logError.message);

    const { error: stateError } = await db.from("factor_verification_state").upsert(
      {
        organization_id: organizationId,
        factor_id: parsed.data.factorId,
        vintage: parsed.data.vintage,
        verified: true,
        current_value: updated?.value ?? null,
        cited_source: parsed.data.citedSource.trim(),
        verified_by: session.user.id,
        verified_at: verifiedAt,
        last_verification_id: logRow?.id ?? null,
      },
      { onConflict: "organization_id,factor_id,vintage" }
    );
    if (stateError) throw new Error(stateError.message);

    await auditEvent({
      organizationId,
      action: "factor.verified",
      entityType: "factor",
      entityId: logRow?.id ?? null,
      payload: {
        factor_id: parsed.data.factorId,
        vintage: parsed.data.vintage,
        cited_source: parsed.data.citedSource.trim(),
        previous_value: existing?.value ?? null,
        current_value: updated?.value ?? null,
        factor_set_version: nextVersion,
      },
    });

    return NextResponse.json({
      ok: true,
      factor: {
        id: parsed.data.factorId,
        vintage: parsed.data.vintage,
        value: updated?.value ?? null,
        source: parsed.data.citedSource.trim(),
        verified: true,
      },
    });
  } catch (e) {
    return jsonError(e);
  }
}
