import Link from "next/link";

export default function PrivacyPage() {
  return (
    <div className="min-h-screen bg-stone-50 px-6 py-16 text-stone-900">
      <div className="mx-auto max-w-2xl">
        <p className="text-[11px] uppercase tracking-widest text-stone-500">DPDP notice</p>
        <h1 className="mt-1 text-xl font-semibold">Privacy</h1>
        <p className="mt-6 text-sm leading-relaxed text-stone-700">
          VerifyStack is sold only to verification firms (ACVAs / empanelled energy auditors).
          Evidence files you upload — invoices, lab certificates, electricity bills, and similar
          plant records — may be sent to Google Gemini for classification and field extraction
          when a Gemini API key is configured for your deployment.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-stone-700">
          Do not upload evidence unless the verification firm has a lawful basis to process that
          personal data and industrial record under the Digital Personal Data Protection Act, 2023
          and applicable BEE / CCTS confidentiality terms. Extraction output is a proposal only;
          a named verifier must accept or reject every high-materiality field.
        </p>
        <p className="mt-4 text-sm leading-relaxed text-stone-700">
          Audit events are append-only. Calculation runs are hash-chained. We do not use extracted
          values to train models in this application.
        </p>
        <Link href="/" className="mt-8 inline-block text-sm underline">
          Back
        </Link>
      </div>
    </div>
  );
}
