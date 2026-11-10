import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { createDataClient } from "@verifystack/backend/lib/supabase/admin";
import { rollUpCanonicalEvidenceValues } from "@verifystack/backend/domain/evidence/operations";
import type { CevAggregationMethod } from "@verifystack/backend/domain/evidence/types";

/**
 * POST /api/cev/rollup
 *
 * Aggregate N accepted/corrected monthly CEV rows into one annual CEV.
 *
 * Working agreement: code computes; models never do.
 * The computed_value is derived server-side from the child rows' effective
 * numeric values — never from the request body.
 *
 * Body:
 *   engagementId     string
 *   canonicalKey     string
 *   childIds         string[]          ids of accepted/corrected monthly children
 *   aggregationMethod "sum"|"mean"|"weighted_mean"
 *   registryVersion  string
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session?.organizationId) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (!hasCapability(session.role, "review.decide")) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = (await request.json()) as {
    engagementId?: string;
    canonicalKey?: string;
    childIds?: string[];
    aggregationMethod?: string;
    registryVersion?: string;
  };

  const { engagementId, canonicalKey, childIds, aggregationMethod, registryVersion } = body;

  if (!engagementId || !canonicalKey || !childIds?.length) {
    return NextResponse.json(
      { ok: false, error: "engagementId, canonicalKey and childIds are required" },
      { status: 400 }
    );
  }

  const allowedMethods: CevAggregationMethod[] = ["sum", "mean", "weighted_mean"];
  const method = (aggregationMethod ?? "sum") as CevAggregationMethod;
  if (!allowedMethods.includes(method)) {
    return NextResponse.json({ ok: false, error: "Invalid aggregationMethod" }, { status: 400 });
  }

  // Fetch the child rows to compute the aggregate value server-side.
  // Code computes; models never do — computed_value is never taken from the request.
  const db = createDataClient();
  if (!db) {
    return NextResponse.json({ ok: false, error: "Database not available" }, { status: 503 });
  }

  const { data: children, error: fetchError } = await db
    .from("canonical_evidence_values")
    .select("id, state, value_numeric, correction_numeric, correction_unit, value_unit, registry_version")
    .in("id", childIds)
    .eq("canonical_key", canonicalKey)
    .eq("engagement_id", engagementId)
    .eq("organization_id", session.organizationId);

  if (fetchError || !children) {
    return NextResponse.json(
      { ok: false, error: fetchError?.message ?? "Could not fetch children" },
      { status: 500 }
    );
  }

  if (children.length !== childIds.length) {
    return NextResponse.json(
      {
        ok: false,
        error: `Expected ${childIds.length} children, found ${children.length}. Some may not belong to this engagement/key.`,
      },
      { status: 400 }
    );
  }

  const invalid = children.filter((c) => !["accepted", "corrected"].includes(c.state));
  if (invalid.length > 0) {
    return NextResponse.json(
      {
        ok: false,
        error: `${invalid.length} child(ren) are not in accepted/corrected state.`,
      },
      { status: 422 }
    );
  }

  // Effective numeric per child — correction takes precedence (code computes, models never do)
  const effectiveValues = children.map((c) => {
    const v = c.state === "corrected" && c.correction_numeric !== null
      ? c.correction_numeric
      : (c.value_numeric ?? 0);
    return v;
  });

  let computedValue: number;
  if (method === "sum") {
    computedValue = effectiveValues.reduce((acc, v) => acc + v, 0);
  } else if (method === "mean") {
    computedValue = effectiveValues.reduce((acc, v) => acc + v, 0) / effectiveValues.length;
  } else {
    // weighted_mean: treat all weights as equal for now (mass-weighted requires extra data)
    computedValue = effectiveValues.reduce((acc, v) => acc + v, 0) / effectiveValues.length;
  }

  // Derive unit from first child (they should all share a unit)
  const valueUnit =
    (children[0]?.state === "corrected" ? children[0].correction_unit : null) ??
    children[0]?.value_unit ??
    "";

  const resolvedRegistryVersion = registryVersion ?? children[0]?.registry_version ?? "v0.2.0-provisional";

  try {
    const result = await rollUpCanonicalEvidenceValues({
      engagement_id: engagementId,
      organization_id: session.organizationId,
      canonical_key: canonicalKey,
      registry_version: resolvedRegistryVersion,
      child_ids: childIds,
      period_kind: "annual",
      aggregation_method: method,
      computed_value: computedValue,
      value_unit: valueUnit,
      created_by: session.user.id,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json({ ok: false, error: msg }, { status: 422 });
  }
}
