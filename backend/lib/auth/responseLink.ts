import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { inviteSigningSecret } from "./firmInvite";

/**
 * Per-issue response links (DFD 7.0).
 *
 * The entity under verification has no account. The verifier sends one signed,
 * expiring link per issue. The token proves exactly three things: which issue,
 * which firm, and until when. It carries no role and opens no other page. The
 * issue row holds a matching `response_nonce`; clearing it revokes the link
 * before expiry, and it is cleared once a response is submitted.
 *
 * Signed with the same secret family as firm invites, with a distinct `purpose`
 * so a token minted for one cannot be replayed as the other.
 */

export const RESPONSE_LINK_TTL_MS = 14 * 24 * 60 * 60 * 1000;
const PURPOSE = "issue-response";

export interface ResponseLinkPayload {
  findingId: string;
  engagementId: string;
  organizationId: string;
  exp: number;
  nonce: string;
}

function sign(body: string, key: string): string {
  return createHmac("sha256", key).update(`${PURPOSE}.${body}`).digest("base64url");
}

export function newResponseNonce(): string {
  return randomBytes(12).toString("hex");
}

export function signResponseLink(
  input: Omit<ResponseLinkPayload, "exp"> & { exp?: number },
  key = inviteSigningSecret()
): string {
  const payload: ResponseLinkPayload = { ...input, exp: input.exp ?? Date.now() + RESPONSE_LINK_TTL_MS };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${sign(body, key)}`;
}

export function verifyResponseLink(
  token: string,
  key = inviteSigningSecret(),
  now = Date.now()
): ResponseLinkPayload | null {
  if (token.length > 2_000) return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const a = Buffer.from(token.slice(dot + 1));
  const b = Buffer.from(sign(body, key));
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const p = parsed as Partial<ResponseLinkPayload>;
  if (
    typeof p.findingId !== "string" ||
    typeof p.engagementId !== "string" ||
    typeof p.organizationId !== "string" ||
    typeof p.nonce !== "string" ||
    typeof p.exp !== "number" ||
    p.exp <= now
  ) {
    return null;
  }
  return {
    findingId: p.findingId,
    engagementId: p.engagementId,
    organizationId: p.organizationId,
    exp: p.exp,
    nonce: p.nonce,
  };
}

export function responseLinkPath(token: string): string {
  return `/respond/${encodeURIComponent(token)}`;
}
