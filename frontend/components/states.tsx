import Link from "next/link";
import { Inbox, Lock, Settings2, XOctagon } from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonVariants } from "@/components/ui/button";

export function EmptyState({
  title,
  body,
  action,
  icon: Icon = Inbox,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="rounded-lg border border-dashed border-mist-300 bg-white px-6 py-14 text-center">
      <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-teal-50 text-teal-700">
        <Icon className="size-5" />
      </span>
      <h2 className="mt-4 text-[15px] font-semibold text-mist-900">{title}</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-mist-600">{body}</p>
      {action ? (
        <Link href={action.href} className={cn(buttonVariants(), "mt-5")}>
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div
      role="status"
      className="flex items-center justify-center gap-3 rounded-lg border border-mist-200 bg-white px-6 py-10 text-sm text-mist-500"
    >
      <span className="size-4 animate-spin rounded-full border-2 border-mist-200 border-t-teal-600" />
      {label}
    </div>
  );
}

export function ErrorState({
  title = "Something went wrong",
  body,
}: {
  title?: string;
  body: string;
}) {
  return (
    <div role="alert" className="flex gap-3 rounded-lg border border-red-200 bg-red-50 px-5 py-4 text-sm">
      <XOctagon aria-hidden className="mt-0.5 size-4 shrink-0 text-red-600" />
      <div>
        <p className="font-medium text-red-950">{title}</p>
        <p className="mt-0.5 text-red-800">{body}</p>
      </div>
    </div>
  );
}

export function ForbiddenState({
  body = "You do not have permission to view this.",
}: {
  body?: string;
}) {
  return (
    <div className="rounded-lg border border-mist-200 bg-white px-6 py-14 text-center">
      <span className="mx-auto flex size-10 items-center justify-center rounded-full bg-mist-100 text-mist-600">
        <Lock className="size-5" />
      </span>
      <h2 className="mt-4 text-[15px] font-semibold text-mist-900">Not available for your role</h2>
      <p className="mx-auto mt-1.5 max-w-md text-sm leading-relaxed text-mist-600">{body}</p>
    </div>
  );
}

export function ConfigureSupabase({ className }: { className?: string }) {
  return (
    <div className={cn("rounded-lg border border-mist-200 bg-white px-6 py-8", className)}>
      <div className="flex gap-3">
        <Settings2 aria-hidden className="mt-0.5 size-5 shrink-0 text-teal-700" />
        <div>
          <h2 className="text-[15px] font-semibold text-mist-900">Connect Supabase to use the workbench</h2>
          <p className="mt-1.5 max-w-xl text-sm leading-relaxed text-mist-600">
            Copy <code className="rounded-sm bg-mist-100 px-1 font-mono text-xs">.env.example</code> to{" "}
            <code className="rounded-sm bg-mist-100 px-1 font-mono text-xs">frontend/.env.local</code> and
            set <code className="rounded-sm bg-mist-100 px-1 font-mono text-xs">NEXT_PUBLIC_SUPABASE_URL</code>{" "}
            and{" "}
            <code className="rounded-sm bg-mist-100 px-1 font-mono text-xs">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
          </p>
        </div>
      </div>
    </div>
  );
}
