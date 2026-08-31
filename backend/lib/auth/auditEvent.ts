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
}

/**
 * Append-only D7 write. Goes through SECURITY DEFINER function append_audit_event.
 * Never UPDATE/DELETE audit_events from application code.
 */
export async function auditEvent(input: AuditEventInput): Promise<string> {
  if (!input.organizationId) {
    throw new AuthError("audit_events require organization_id", 403);
  }

  const supabase = createServiceClient() ?? (await createServerSupabase());
  if (!supabase) {
    throw new AuthError("Supabase is not configured", 401);
  }

  const { data, error } = await supabase.rpc("append_audit_event", {
    p_organization_id: input.organizationId,
    p_action: input.action,
    p_entity_type: input.entityType,
    p_entity_id: input.entityId ?? null,
    p_payload: input.payload ?? {},
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
