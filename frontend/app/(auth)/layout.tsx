import Link from "next/link";
import { FileSearch, PenLine, ShieldCheck } from "lucide-react";
import { AuthHashRedirect } from "@/components/auth/hash-redirect";
import { Logo } from "@/components/brand/logo";

const POINTS = [
  {
    icon: FileSearch,
    title: "Every figure traced to its source",
    body: "Each accepted value links back to the page, cell, time range or site observation it came from.",
  },
  {
    icon: ShieldCheck,
    title: "Code computes, people decide",
    body: "AI proposes values for review. Only accepted facts reach the calculation engine.",
  },
  {
    icon: PenLine,
    title: "Two-person sign-off",
    body: "A preparer and a reviewer each attest by name before a report leaves the firm.",
  },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <AuthHashRedirect />

      <aside className="hidden flex-col justify-between p-4 lg:flex">
        <div className="glass flex h-full flex-col justify-between rounded-3xl px-10 py-9">
          <Link href="/" className="w-fit rounded-md" aria-label="VerifyStack home">
            <Logo />
          </Link>

          <div className="max-w-md">
            <p className="eyebrow text-teal-700">For verification and energy audit firms</p>
            <h2 className="mt-3 text-[2rem] leading-[1.1] font-medium tracking-[-0.03em] text-mist-950">
              Verification work that{" "}
              <em className="font-display text-[1.1em] font-normal text-teal-800">
                holds up in front of a regulator.
              </em>
            </h2>
            <ul className="mt-10 space-y-6">
              {POINTS.map(({ icon: Icon, title, body }) => (
                <li key={title} className="flex gap-3.5">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-teal-700/10 text-teal-800">
                    <Icon aria-hidden className="size-4" />
                  </span>
                  <div>
                    <p className="text-sm font-medium text-mist-900">{title}</p>
                    <p className="mt-0.5 text-[13px] leading-relaxed text-mist-600">{body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>

          <div className="flex items-center justify-between text-xs text-mist-500">
            <span>CCTS and ADEETIE engagements</span>
            <span className="flex items-center gap-4">
              <Link href="/privacy" className="hover:text-mist-800 hover:underline">
                Privacy
              </Link>
              <Link href="/terms" className="hover:text-mist-800 hover:underline">
                Terms
              </Link>
            </span>
          </div>
        </div>
      </aside>

      <main className="flex flex-col px-6 py-10 sm:px-10">
        <Link href="/" className="mb-10 w-fit lg:hidden" aria-label="VerifyStack home">
          <Logo />
        </Link>
        <div className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center">{children}</div>
      </main>
    </div>
  );
}
