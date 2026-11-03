import { ContactLine, LegalPage, type LegalSection } from "@/components/marketing/legal-page";

export const metadata = { title: "Privacy notice" };

/*
 * Plain-language notice that describes what the product does today.
 * It is not a substitute for advice from counsel on the DPDP Act, 2023.
 * Keep it in step with SECURITY.md and docs/domain/regulatory-register.md.
 */
const SECTIONS: LegalSection[] = [
  {
    id: "who",
    title: "Who this applies to",
    body: (
      <>
        <p>
          VerifyStack is sold only to verification firms (ACVAs and empanelled energy auditors). The
          firm decides what evidence goes in and why. VerifyStack stores and processes it on the
          firm&apos;s behalf, to run the verification work the firm has been engaged to do.
        </p>
        <p>
          The audited entity does not hold an account. If a firm sends an entity a response link,
          this notice also applies to what that entity submits through it.
        </p>
      </>
    ),
  },
  {
    id: "what",
    title: "What we process",
    body: (
      <ul>
        <li>
          <strong>Account details:</strong> name, work email and role, through email and password or
          Google sign-in.
        </li>
        <li>
          <strong>Evidence files:</strong> invoices, lab certificates, electricity bills, production
          logs, spreadsheets and SCADA exports. These can include personal data such as names and
          signatures.
        </li>
        <li>
          <strong>Extracted and entered values,</strong> with the page, cell, time range or
          observation each came from.
        </li>
        <li>
          <strong>Site fieldwork:</strong> observations, meter readings, interview notes and photos
          recorded by a verifier, with time and the recording user.
        </li>
        <li>
          <strong>Entity responses:</strong> the text and files an entity submits through a
          single-use link.
        </li>
        <li>
          <strong>Audit trail:</strong> who did what and when, kept as an append-only log.
        </li>
      </ul>
    ),
  },
  {
    id: "ai",
    title: "AI processing",
    body: (
      <>
        <p>
          When a Gemini API key is configured for a deployment, evidence pages may be sent to Google
          Gemini to classify documents and propose field values, and finding text may be sent to
          draft citations and corrective-action wording. We do not use extracted values to train
          models in this application.
        </p>
        <p>
          Model output is a proposal. A named verifier must accept or reject each material value,
          and no model output is ever used as a number in a calculation.
        </p>
      </>
    ),
  },
  {
    id: "lawful",
    title: "What firms must do",
    body: (
      <p>
        Do not upload evidence unless your firm has a lawful basis to process the personal data and
        industrial records in it under the Digital Personal Data Protection Act, 2023, and under any
        confidentiality terms that apply to the scheme and to your engagement.
      </p>
    ),
  },
  {
    id: "keep",
    title: "Keeping and deleting data",
    body: (
      <>
        <p>
          Audit events, accepted facts, calculation runs and sign-offs are append-only by design, so
          that a verification can be reproduced and inspected later. Evidence files are kept under
          their content hash.
        </p>
        <p>
          A self-service deletion workflow is not built yet. Retention and erasure requests are
          handled with us directly, case by case, and we will tell you what can be removed and what
          the append-only record requires us to keep.
        </p>
      </>
    ),
  },
  {
    id: "cookies",
    title: "Cookies and monitoring",
    body: (
      <p>
        We use only the cookies needed to keep you signed in. There is no advertising or cross-site
        tracking. Optional error monitoring may be enabled on a deployment, and it is configured not
        to collect personal information by default.
      </p>
    ),
  },
  {
    id: "rights",
    title: "Your rights and how to reach us",
    body: (
      <>
        <p>
          You can ask to access, correct or erase personal data we hold, withdraw consent where
          consent is the basis, and raise a grievance. If your data was uploaded by a verification
          firm, we may refer the request to that firm.
        </p>
        <p>
          <ContactLine topic="a privacy request" />
        </p>
      </>
    ),
  },
  {
    id: "changes",
    title: "Changes to this notice",
    body: (
      <p>
        When the product changes what it does with data, we change this page first and update the
        review date above.
      </p>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <LegalPage
      kicker="DPDP notice"
      title="Privacy notice"
      intro="What VerifyStack stores, why, who can see it, and what we do not do with it."
      sections={SECTIONS}
    />
  );
}
