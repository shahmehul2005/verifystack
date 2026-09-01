import "server-only";

/**
 * Platform stewardship of the factor catalogue.
 *
 * D8 holds two different jobs that the capability map cannot tell apart,
 * because one of them is not a firm's job at all.
 *
 *   Curating the value. The CEA grid emission factor, the IPCC fuel factors and
 *   the published calorific values are the same number for every customer. If a
 *   firm may type its own figure and have the engine accept it as verified, the
 *   refusal of unverified factors is theatre: the control can be satisfied by
 *   asserting whatever the answer needs to be. Deciding what a publication says
 *   is therefore ours, and shipping it wrong is a product defect, not a client
 *   finding.
 *
 *   Attesting the vintage. Whether CEA v20.0 is the right edition for this
 *   compliance year, for this engagement, is an audit judgement. It belongs to
 *   the lead verifier, it is engagement-specific, and it goes in the working
 *   paper under a named person.
 *
 * A steward is identified by email rather than by membership role, because
 * stewardship is not a role inside a customer's firm. Set
 * VERIFYSTACK_STEWARD_EMAILS to a comma-separated list.
 *
 * With the list empty, no one is a steward and no one may overwrite a catalogue
 * value. Verifiers can still attest the shipped value against a citation, which
 * is the flow that matters, so an unset variable fails closed rather than
 * reopening the hole.
 */

export function stewardEmails(): string[] {
  return (process.env.VERIFYSTACK_STEWARD_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isPlatformSteward(email: string | null | undefined): boolean {
  if (!email) return false;
  return stewardEmails().includes(email.trim().toLowerCase());
}

export const STEWARD_ONLY_VALUE_CHANGE =
  "Changing a catalogue factor value is a platform stewardship action, not a firm action: the " +
  "published figure is the same for every customer, so a firm-local override would let the " +
  "unverified-factor control be satisfied by assertion. Record the citation to attest the value " +
  "as shipped. If the shipped value is wrong, raise it with the platform team — the correction " +
  "belongs in the catalogue, for everyone.";
