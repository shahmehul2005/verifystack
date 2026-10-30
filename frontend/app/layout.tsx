import type { Metadata, Viewport } from "next";
import { Instrument_Sans, JetBrains_Mono } from "next/font/google";
import { AssistantWidget } from "@/components/assistant/assistant-widget";
import { Providers } from "@/components/providers";
import "./globals.css";

/** Interface and body text. */
const sans = Instrument_Sans({
  variable: "--font-sans-face",
  subsets: ["latin"],
  display: "swap",
});

/** Identifiers, hashes and tabular figures. */
const mono = JetBrains_Mono({
  variable: "--font-mono-face",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: {
    default: "VerifyStack — verification workbench for CCTS and ADEETIE",
    template: "%s · VerifyStack",
  },
  description:
    "Operational verification workbench for ACVAs and energy auditors under India's CCTS and ADEETIE schemes. Evidence with provenance, a deterministic engine, planning, fieldwork, technical review and a submission package. Sold only to verifiers. AI proposes; humans decide.",
  applicationName: "VerifyStack",
};

export const viewport: Viewport = {
  themeColor: "#f4f7f5",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en-IN"
      className={`${sans.variable} ${mono.variable} h-full antialiased`}
    >
      <body className="min-h-full font-sans text-mist-900">
        <Providers>
          {children}
          <AssistantWidget />
        </Providers>
      </body>
    </html>
  );
}
