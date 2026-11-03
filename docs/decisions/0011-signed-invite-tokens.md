# 0011. Signed invite tokens

- Status: Accepted (replaces Supabase `inviteUserByEmail`)
- Date: 2026-09-05

## Context

Supabase invites created an Auth user with no password, so invited members could not sign in
without a reset email, and hosted Auth limits outbound mail on new projects.

## Decision

A firm admin's invite is an HMAC-SHA256 signed token carrying email, organisation, role, display
name, expiry (14 days) and a nonce (`backend/lib/auth/firmInvite.ts`). The Team page returns
`/signup?invite=<token>` and Resend emails it when configured. No Auth user exists until the
invitee signs up. `/api/auth/signup` verifies the signature, requires the same email, creates
the user with a password and the invited role, and refuses an email that belongs to another
firm. Self-serve signup (no token) creates a `firm_admin` and sends a confirmation link.

## Consequences

- Invitees set their own password at signup and can sign in immediately.
- Tokens are signed with `INVITE_SIGNING_SECRET`, or `SUPABASE_SERVICE_ROLE` when that is unset.
  Rotating that key invalidates outstanding invites. Set the dedicated secret in production.
- An invite never sets the password of a confirmed account. If the invited email already has
  one, the invitee must enter that account's password to join.
- Tokens are not stored, so they cannot be revoked before expiry and can be reused until they
  expire. Reuse can only re-add the invited membership. See `SECURITY.md`.
