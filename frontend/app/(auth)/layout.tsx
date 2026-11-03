import Link from "next/link";
import { AuthHashRedirect } from "@/components/auth/hash-redirect";
import { Logo } from "@/components/brand/logo";

const POINTS = [
  {
    title: "Every figure traced to its source",
    body: "Each accepted value links back to the page, cell, time range or site observation it came from.",
  },
  {
    title: "Code computes, people decide",
    body: "AI proposes values for review. Only accepted facts reach the calculation engine.",
  },
  {
    title: "Two-person sign-off",
    body: "A preparer and a reviewer each attest by name before a report leaves the firm.",
  },
];

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
      <AuthHashRedirect />

      <aside className="hidden flex-col justify-between bg-mist-200 px-12 py-10 lg:flex">
        <Link href="/" className="w-fit rounded-md" aria-label="VerifyStack home">
          <Logo />
        </Link>

        <div className="max-w-md">
          <h2 className="text-[2.25rem] leading-[1.08] font-medium tracking-[-0.03em] text-mist-950">
            Verification work that holds up in front of a regulator.
          </h2>
          <p className="mt-4 text-base text-mist-700">For verification and energy audit firms.</p>
          <ul className="mt-10 space-y-6">
            {POINTS.map(({ title, body }) => (
              <li key={title}>
                <p className="text-[1.0625rem] font-medium text-mist-900">{title}</p>
                <p className="mt-1 text-[15px] leading-relaxed text-mist-700">{body}</p>
              </li>
            ))}
          </ul>
        </div>

        <div className="flex items-center justify-between text-sm text-mist-600">
          <span>CCTS and ADEETIE engagements</span>
          <span className="flex items-center gap-4">
            <Link href="/privacy" className="hover:text-mist-900 hover:underline">
              Privacy
            </Link>
            <Link href="/terms" className="hover:text-mist-900 hover:underline">
              Terms
            </Link>
          </span>
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
