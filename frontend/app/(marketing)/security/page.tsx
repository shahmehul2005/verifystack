import { ContactLine, LegalPage, type LegalSection } from "@/components/marketing/legal-page";

export const metadata = { title: "Security" };

/*
 * A customer-facing summary of SECURITY.md. State only controls that exist in the code,
 * and keep the detail of open gaps in the repository, not on a public page.
 */
const SECTIONS: LegalSection[] = [
  {
    id: "approach",
    title: "Our approach",
    body: (
      <p>
        VerifyStack holds confidential plant evidence for firms that compete with each other. The
        design assumes that a mistake in one place must not expose another firm&apos;s data, and that
        the record of a verification must not be changeable after the fact.
      </p>
    ),
  },
  {
    id: "isolation",
    title: "Tenant isolation",
    body: (
      <ul>
        <li>Every tenant table carries the owning firm and is protected by row-level security.</li>
        <li>
          Signed-in users can read their own firm&apos;s rows. Writes go only through server routes
          that check the user&apos;s role and firm.
        </li>
        <li>Four roles share one capability map used by the menu, the page and the route.</li>
      </ul>
    ),
  },
  {
    id: "integrity",
    title: "Integrity of the record",
    body: (
      <ul>
        <li>
          Audit events, facts, calculation runs and sign-offs are append-only. Updates and deletes
          are refused at the database, for every role.
        </li>
        <li>
          Each calculation run records the engine version, pack version and an input hash, and is
          chained to the one before it.
        </li>
        <li>
          Sign-off needs two different people. It is refused while a blocking finding is open or
          while a required technical review is missing or out of date.
        </li>
      </ul>
    ),
  },
  {
    id: "evidence",
    title: "Evidence handling",
    body: (
      <ul>
        <li>Files are hashed on arrival and kept in a private store under that hash.</li>
        <li>
          The type of a file is read from its contents, not from what the browser claims, and only a
          short list of document and image types is accepted.
        </li>
        <li>Downloads are authorised per request and are never cached publicly.</li>
        <li>
          Entity response links are single-use, signed, time-limited and bound to one issue.
        </li>
      </ul>
    ),
  },
  {
    id: "auth",
    title: "Sign-in and access",
    body: (
      <ul>
        <li>Email sign-in requires confirmation. Firm invitations are signed and bound to one email and role.</li>
        <li>Signup can be restricted to invited users or to listed email domains.</li>
        <li>Rate limits apply to sign-up, invitations, response links and every route that calls a model.</li>
      </ul>
    ),
  },
  {
    id: "ai",
    title: "AI processing",
    body: (
      <p>
        When enabled, evidence pages and finding text are sent to the Google Gemini API for
        extraction and drafting. Model output is stored as a suggestion for a person to accept, and
        is never used as a number in a calculation.
      </p>
    ),
  },
  {
    id: "browser",
    title: "Browser and transport",
    body: (
      <p>
        State-changing requests from other sites are refused, responses carry anti-framing and
        content-type protections, and production traffic is served over HTTPS with strict transport
        security.
      </p>
    ),
  },
  {
    id: "disclosure",
    title: "Reporting a vulnerability",
    body: (
      <>
        <p>
          Please do not open a public issue. Tell us what you found, how to reproduce it and what you
          think the impact is, and give us a reasonable time to fix it before you share it.
        </p>
        <p>
          <ContactLine topic="a security report" />
        </p>
      </>
    ),
  },
  {
    id: "limits",
    title: "What this page is not",
    body: (
      <p>
        We are an early product and have not yet had an independent security audit or certification.
        We track the controls we have not built yet, and we will discuss them with any firm that
        asks before it onboards.
      </p>
    ),
  },
];

export default function SecurityPage() {
  return (
    <LegalPage
      kicker="Trust"
      title="Security"
      intro="How tenant data is separated, how the record is protected, and how to tell us about a problem."
      sections={SECTIONS}
    />
  );
}
