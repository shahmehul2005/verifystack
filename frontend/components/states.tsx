import Link from "next/link";
import { cn } from "@/lib/cn";

export function EmptyState({
  title,
  body,
  action,
}: {
  title: string;
  body: string;
  action?: { href: string; label: string };
}) {
  return (
    <div className="border border-dashed border-stone-300 bg-white px-6 py-12 text-center">
      <h2 className="text-sm font-semibold text-stone-900">{title}</h2>
      <p className="mx-auto mt-2 max-w-md text-sm text-stone-600">{body}</p>
      {action ? (
        <Link
          href={action.href}
          className="mt-4 inline-flex h-9 items-center bg-stone-900 px-3.5 text-sm text-white"
        >
          {action.label}
        </Link>
      ) : null}
    </div>
  );
}

export function LoadingState({ label = "Loading…" }: { label?: string }) {
  return (
    <div className="border border-stone-200 bg-white px-6 py-10 text-center text-sm text-stone-500">
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
    <div className="border border-red-200 bg-red-50 px-6 py-8 text-sm text-red-900">
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-red-800">{body}</p>
    </div>
  );
}

export function ForbiddenState({
  body = "You do not have permission to view this.",
}: {
  body?: string;
}) {
  return (
    <div className="border border-stone-300 bg-stone-50 px-6 py-10 text-center">
      <p className="text-[11px] uppercase tracking-widest text-stone-500">Forbidden</p>
      <p className="mt-2 text-sm text-stone-700">{body}</p>
    </div>
  );
}

export function ConfigureSupabase({ className }: { className?: string }) {
  return (
    <div className={cn("border border-stone-300 bg-white px-6 py-10", className)}>
      <p className="text-[11px] uppercase tracking-widest text-stone-500">Not configured</p>
      <h2 className="mt-1 text-sm font-semibold">Configure Supabase to use the workbench</h2>
      <p className="mt-2 max-w-xl text-sm text-stone-600">
        Copy <code className="font-mono text-[12px]">.env.example</code> to{" "}
        <code className="font-mono text-[12px]">frontend/.env.local</code> and set{" "}
        <code className="font-mono text-[12px]">NEXT_PUBLIC_SUPABASE_URL</code> and{" "}
        <code className="font-mono text-[12px]">NEXT_PUBLIC_SUPABASE_ANON_KEY</code>.
      </p>
    </div>
  );
}
