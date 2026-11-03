import "server-only";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import type { Json } from "@verifystack/backend/lib/supabase/types";
import { AuthError } from "./getSession";

export interface AuditEventInput {
  organizationId: string;
  action: string;
  entityType: string;
  entityId?: string | null;
  payload?: Json;
  /** The signed-in user who performed the action. Null for background jobs. */
  actorUserId?: string | null;
}

/** PostgREST / Postgres codes for "function does not exist" (migration 0012 not applied). */
const MISSING_FUNCTION = new Set(["PGRST202", "42883"]);

/**
 * Append-only D7 write through a SECURITY DEFINER function.
 * Never UPDATE/DELETE audit_events from application code.
 *
 * The service role has no auth.uid(), so the actor is passed explicitly to
 * append_audit_event_as (migration 0012). Until that migration is applied the
 * older function is used and the actor is kept in the payload instead.
 */
export async function auditEvent(input: AuditEventInput): Promise<string> {
  if (!input.organizationId) {
    throw new AuthError("audit_events require organization_id", 403);
  }

  const admin = createServiceClient();
  if (admin) {
    const { data, error } = await admin.rpc("append_audit_event_as", {
      p_actor_user_id: input.actorUserId ?? null,
      p_organization_id: input.organizationId,
      p_action: input.action,
      p_entity_type: input.entityType,
      p_entity_id: input.entityId ?? null,
      p_payload: input.payload ?? {},
    });
    if (!error) return data;
    if (!MISSING_FUNCTION.has(error.code)) {
      throw new Error(`audit_events insert failed: ${error.message}`);
    }
  }

  const supabase = admin ?? (await createServerSupabase());
  if (!supabase) {
    throw new AuthError("Supabase is not configured", 401);
  }

  const base = input.payload ?? {};
  const payload: Json =
    input.actorUserId && typeof base === "object" && base !== null && !Array.isArray(base)
      ? { ...base, actor_user_id: input.actorUserId }
      : base;

  const { data, error } = await supabase.rpc("append_audit_event", {
    p_organization_id: input.organizationId,
    p_action: input.action,
    p_entity_type: input.entityType,
    p_entity_id: input.entityId ?? null,
    p_payload: payload,
  });

  if (error) {
    throw new Error(`audit_events insert failed: ${error.message}`);
  }
  return data;
}

/** Pure helper — used in tests to prove we never call without org isolation. */
export function assertAuditPayload(input: AuditEventInput) {
  if (!input.organizationId) {
    throw new AuthError("audit_events require organization_id", 403);
  }
  if (!input.action || !input.entityType) {
    throw new AuthError("audit_events require action and entityType", 403);
  }
  return input;
}
