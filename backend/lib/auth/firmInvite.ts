import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { parseMembershipRole } from "./roles";
import type { MembershipRole } from "@verifystack/backend/lib/supabase/types";

export const INVITE_TTL_MS = 14 * 24 * 60 * 60 * 1000;

export interface FirmInvitePayload {
  email: string;
  organizationId: string;
  role: MembershipRole;
  displayName: string;
  exp: number;
  nonce: string;
}

function secret(): string {
  const value = process.env.SUPABASE_SERVICE_ROLE ?? process.env.INVITE_SIGNING_SECRET;
  if (!value) {
    throw new Error("Invite links need SUPABASE_SERVICE_ROLE (or INVITE_SIGNING_SECRET).");
  }
  return value;
}

function signBody(body: string, key: string): string {
  return createHmac("sha256", key).update(body).digest("base64url");
}

export function inviteExpiresAt(from = Date.now()): number {
  return from + INVITE_TTL_MS;
}

export function signFirmInvite(
  input: Omit<FirmInvitePayload, "exp" | "nonce"> & { exp?: number; nonce?: string },
  key = secret()
): string {
  const payload: FirmInvitePayload = {
    email: input.email.trim().toLowerCase(),
    organizationId: input.organizationId,
    role: input.role,
    displayName: input.displayName,
    exp: input.exp ?? inviteExpiresAt(),
    nonce: input.nonce ?? randomBytes(8).toString("hex"),
  };
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${body}.${signBody(body, key)}`;
}

export function verifyFirmInvite(
  token: string,
  key = secret(),
  now = Date.now()
): FirmInvitePayload | null {
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = signBody(body, key);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const row = parsed as Partial<FirmInvitePayload>;
  const role = parseMembershipRole(row.role);
  if (
    typeof row.email !== "string" ||
    typeof row.organizationId !== "string" ||
    typeof row.displayName !== "string" ||
    typeof row.exp !== "number" ||
    typeof row.nonce !== "string" ||
    !role
  ) {
    return null;
  }
  if (row.exp <= now) return null;
  return {
    email: row.email.trim().toLowerCase(),
    organizationId: row.organizationId,
    role,
    displayName: row.displayName,
    exp: row.exp,
    nonce: row.nonce,
  };
}

export function inviteSignupPath(token: string): string {
  return `/signup?invite=${encodeURIComponent(token)}`;
}

export function inviteSignupUrl(origin: string, token: string): string {
  return `${origin.replace(/\/$/, "")}${inviteSignupPath(token)}`;
}
