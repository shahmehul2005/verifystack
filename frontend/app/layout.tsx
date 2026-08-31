import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VerifyStack — verifier workbench",
  description:
    "Operational verification workbench for ACVAs and energy auditors under India's CCTS and ADEETIE schemes. Sold only to verifiers. AI proposes; humans decide.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en-IN"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full bg-stone-50 font-sans text-stone-900">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
