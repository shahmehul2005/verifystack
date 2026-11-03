import { LegalPage, type LegalSection } from "@/components/marketing/legal-page";

export const metadata = { title: "Licences and notices" };

/** Open-source components the product ships with. Licences are those published by each project. */
const COMPONENTS: { name: string; licence: string; use: string }[] = [
  { name: "Next.js", licence: "MIT", use: "Application framework" },
  { name: "React", licence: "MIT", use: "User interface" },
  { name: "Tailwind CSS", licence: "MIT", use: "Styling" },
  { name: "Lucide", licence: "ISC", use: "Icons" },
  { name: "Supabase client libraries", licence: "MIT", use: "Database and storage access" },
  { name: "TanStack Query", licence: "MIT", use: "Client data fetching" },
  { name: "React Hook Form", licence: "MIT", use: "Forms" },
  { name: "Zod", licence: "MIT", use: "Input validation" },
  { name: "PDF.js", licence: "Apache-2.0", use: "Rendering evidence pages" },
  { name: "pdf-lib", licence: "MIT", use: "PDF handling" },
  { name: "@react-pdf/renderer", licence: "MIT", use: "Report generation" },
  { name: "Sonner", licence: "MIT", use: "Notifications" },
  { name: "Inngest SDK", licence: "Apache-2.0", use: "Background jobs" },
];

const FONTS: { name: string; use: string }[] = [
  { name: "Instrument Sans", use: "Interface text" },
  { name: "Instrument Serif", use: "Display accents" },
  { name: "JetBrains Mono", use: "Identifiers and figures" },
];

const SECTIONS: LegalSection[] = [
  {
    id: "product",
    title: "VerifyStack",
    body: (
      <p>
        VerifyStack is proprietary software. Copyright © {new Date().getFullYear()} VerifyStack. All
        rights reserved. Access is granted under the <a href="/terms">terms of use</a> or a written
        agreement, and does not transfer ownership of the software. The code is not published under
        an open-source licence.
      </p>
    ),
  },
  {
    id: "open-source",
    title: "Open-source components",
    body: (
      <>
        <p>
          We build on the work below. Each remains under its own licence, and nothing on this page
          changes those terms. Licence names are those published by each project; the full text
          travels with each package.
        </p>
        <div className="overflow-x-auto rounded-xl ring-1 ring-mist-900/8">
          <table className="w-full text-left text-sm">
            <thead className="bg-mist-900/4 text-xs text-mist-600">
              <tr>
                <th className="px-4 py-2.5 font-medium">Component</th>
                <th className="px-4 py-2.5 font-medium">Licence</th>
                <th className="px-4 py-2.5 font-medium">Used for</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-mist-900/6">
              {COMPONENTS.map((c) => (
                <tr key={c.name}>
                  <td className="px-4 py-2.5 font-medium text-mist-900">{c.name}</td>
                  <td className="px-4 py-2.5 font-mono text-xs text-mist-600">{c.licence}</td>
                  <td className="px-4 py-2.5 text-mist-600">{c.use}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </>
    ),
  },
  {
    id: "fonts",
    title: "Typefaces",
    body: (
      <>
        <p>
          The typefaces below are used under the SIL Open Font License 1.1, served from our own
          origin at build time.
        </p>
        <ul>
          {FONTS.map((f) => (
            <li key={f.name}>
              <strong>{f.name}</strong> — {f.use}
            </li>
          ))}
        </ul>
      </>
    ),
  },
  {
    id: "reference",
    title: "Reference data and trademarks",
    body: (
      <>
        <p>
          Methodology packs and reference factors summarise published scheme documents. Where a
          value has not been checked against its notified source it is marked unverified in the
          product. The original publication, not VerifyStack, is authoritative.
        </p>
        <p>
          Names such as CCTS, ADEETIE, BEE and CBAM belong to their respective owners and appear
          only to say which schemes the product supports. VerifyStack is not affiliated with or
          endorsed by them.
        </p>
      </>
    ),
  },
];

export default function LicensesPage() {
  return (
    <LegalPage
      kicker="Legal"
      title="Licences and notices"
      intro="What VerifyStack is licensed as, and the open-source work it stands on."
      sections={SECTIONS}
    />
  );
}
