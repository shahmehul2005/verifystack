# 0018. Issues have a lifecycle, and the entity answers through a signed one-time link

- Status: Accepted
- Date: 2026-10-09

## Context

A finding used to be decided by the verifier and closed. In practice a finding is a question put to
the entity: it answers, the verifier judges the answer, and only then is the matter closed. The
entity has no account and should not need one, but a link that opens more than one issue, or can be
reused, would be a hole in tenant isolation ([0008](0008-tenant-isolation.md)).

## Decision

Findings move through `suggested`, `accepted` or `edited`, `open`, `responded`, `verified`, `closed`
(or `rejected`), with the transitions in `backend/domain/issues/lifecycle.ts`. A `block` issue
cannot close straight from a decided draft: it has to be opened, answered and verified. `warn` and
`info` issues may close early because they inform rather than gate.

Opening an issue mints a link: an HMAC-signed token naming one issue, one firm and an expiry
(`backend/lib/auth/responseLink.ts`), signed with the invite secret family under a distinct
purpose ([0011](0011-signed-invite-tokens.md)). The token must also match the `response_nonce` on
the issue, so the link dies when the nonce is cleared: on a response, on revoking, on issuing a
new link, and on closing. The public route accepts one response, attaches any files as evidence
with `source = 'entity_response'`, moves the issue to `responded` with a compare-and-set, and is
rate limited per IP and per link. It reads and writes nothing else.

A verifier can also record a response received off-platform; it is stored as such and not
presented as the entity's own.

## Consequences

- The conversation with the entity is on the record and tied to the evidence.
- The link is shown once, at creation. Losing it means issuing another.
- The response form is public. Its limits (five files, 10 MB each, no archives) and rate limits are
  policy values and are listed as internal.
- The 14-day default due date is a firm default, not a scheme period.
