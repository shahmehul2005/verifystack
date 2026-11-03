import { ContactLine, LegalPage, type LegalSection } from "@/components/marketing/legal-page";

export const metadata = { title: "Terms of use" };

/*
 * Working terms for a pre-launch product. They describe how the product behaves
 * and where responsibility sits. They have not been reviewed by counsel: the
 * governing entity, liability cap, jurisdiction and fees must be settled with a
 * lawyer before the first paid customer. Tracked in docs/product/open-questions.md.
 */
const SECTIONS: LegalSection[] = [
  {
    id: "scope",
    title: "What these terms cover",
    body: (
      <p>
        These terms govern use of VerifyStack by a verification firm and its staff. VerifyStack is
        provided to firms that carry out verification or energy-audit work. It is not offered to the
        entities being audited. A signed order form or agreement with us takes precedence over this
        page.
      </p>
    ),
  },
  {
    id: "accounts",
    title: "Accounts and roles",
    body: (
      <ul>
        <li>A firm is responsible for who it invites and for the role each person is given.</li>
        <li>Keep your sign-in details to yourself. Tell us promptly if you suspect misuse.</li>
        <li>
          Sign-off needs two different people in two different roles. You may not work around that.
        </li>
      </ul>
    ),
  },
  {
    id: "data",
    title: "Your data",
    body: (
      <>
        <p>
          You keep ownership of the evidence you upload and the work you produce. You give us the
          permission needed to store and process it to run the service, as described in the{" "}
          <a href="/privacy">privacy notice</a>.
        </p>
        <p>
          You are responsible for having the right to upload what you upload, including any personal
          data in it.
        </p>
      </>
    ),
  },
  {
    id: "responsibility",
    title: "Professional responsibility",
    body: (
      <>
        <p>
          VerifyStack assists a verifier. It does not verify anything on its own, and it does not
          replace the verifier&apos;s judgement, accreditation or duties to a regulator.
        </p>
        <ul>
          <li>
            AI-proposed values are proposals. The reviewing verifier is responsible for each value
            they accept.
          </li>
          <li>
            Methodology packs, emission factors and thresholds are reference data. Values marked as
            unverified must be checked against the notified source before they are relied on.
          </li>
          <li>
            Nothing in the product is legal, regulatory or engineering advice.
          </li>
          <li>
            The submission package is a generic bundle. Check any filing against the format the
            relevant authority currently requires.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: "use",
    title: "Acceptable use",
    body: (
      <ul>
        <li>Do not attempt to read another firm&apos;s data or to bypass access controls.</li>
        <li>Do not upload malware, or content you have no right to share.</li>
        <li>Do not overload the service or use it to build a competing product.</li>
        <li>Do not use the response link feature to send unsolicited messages.</li>
      </ul>
    ),
  },
  {
    id: "service",
    title: "The service",
    body: (
      <p>
        The product is under active development. Features marked as in design, structure only or
        unverified are described that way because they are not ready to rely on. We aim to keep the
        service available but do not promise uninterrupted operation, and we may change or retire a
        feature with reasonable notice.
      </p>
    ),
  },
  {
    id: "ip",
    title: "Intellectual property",
    body: (
      <p>
        VerifyStack, its software, design and documentation belong to us and are licensed to you for
        use under these terms, not sold. All rights not granted are reserved. Third-party components
        keep their own licences, listed on the <a href="/licenses">licences page</a>.
      </p>
    ),
  },
  {
    id: "liability",
    title: "Liability",
    body: (
      <p>
        To the extent the law allows, the service is provided as it is, and we are not liable for
        indirect or consequential loss, or for decisions made on the strength of output a verifier
        did not check. Nothing here limits liability that cannot lawfully be limited.
      </p>
    ),
  },
  {
    id: "law",
    title: "Governing law",
    body: (
      <p>
        These terms are governed by the laws of India. Disputes are subject to the courts of the
        jurisdiction named in your agreement with us.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    body: (
      <p>
        <ContactLine topic="these terms" />
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalPage
      kicker="Legal"
      title="Terms of use"
      intro="The ground rules for using VerifyStack, and where responsibility sits between the product and the verifier."
      sections={SECTIONS}
    />
  );
}
