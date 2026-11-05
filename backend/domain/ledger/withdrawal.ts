/**
 * Withdrawing a fact from the ledger.
 *
 * The removal itself is one database function, `withdraw_fact` (migration 0024), because the facts
 * table is append-only and only that function may lift the guard, for one DELETE inside one
 * transaction. This module holds the part that needs no database: the arguments the function takes
 * and how its refusals read to a person.
 */

/** Same floor as the desk-reading history and the function's own check. */
export const WITHDRAW_MIN_REASON = 8;

export interface WithdrawArgs {
  organizationId: string;
  engagementId: string;
  factId: string;
  reason: string;
  userId: string;
}

/** The parameters of `public.withdraw_fact`, by name. */
export function withdrawRpcParams(a: WithdrawArgs) {
  return {
    p_organization_id: a.organizationId,
    p_engagement_id: a.engagementId,
    p_fact_id: a.factId,
    p_reason: a.reason.trim(),
    p_withdrawn_by: a.userId,
  };
}

export interface WithdrawFailure {
  status: 400 | 404 | 409 | 500;
  message: string;
}

interface RpcError {
  code?: string | null;
  message?: string | null;
}

/**
 * What a refusal from `withdraw_fact` means to the person who pressed the button.
 *
 * Codes are Postgres SQLSTATEs (or PostgREST's own for a missing function):
 *   P0002  no_data_found          the engagement or the fact is not in this organization
 *   23514  check_violation        sign-off has started
 *   22023  invalid_parameter      a missing argument or a short reason
 *   42883 / PGRST202              the function does not exist, so migration 0024 is not applied
 */
export function withdrawFailure(error: RpcError): WithdrawFailure {
  const code = error.code ?? "";
  if (code === "42883" || code === "PGRST202") {
    return { status: 409, message: "Apply migration 0024 first: a fact is only withdrawn through the function that keeps its history." };
  }
  if (code === "P0002") return { status: 404, message: "That fact is not in this engagement." };
  if (code === "23514") return { status: 409, message: "Sign-off has started, so the facts ledger can no longer change." };
  if (code === "22023") return { status: 400, message: `Say why in at least ${WITHDRAW_MIN_REASON} characters.` };
  if (code === "42501") {
    // The append-only guard refused. The function lifts it for its own DELETE, so reaching this means
    // the function was changed or replaced. Do not describe it as a user mistake.
    return { status: 500, message: "The ledger refused the withdrawal. Nothing was changed." };
  }
  return { status: 500, message: error.message ?? "Could not withdraw the fact." };
}
