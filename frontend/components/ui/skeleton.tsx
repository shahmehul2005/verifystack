import { cn } from "@/lib/cn";

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn("animate-pulse rounded-md bg-mist-100", className)} />;
}

/** Placeholder for a page while its server data loads. */
export function PageSkeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div role="status" aria-label="Loading">
      <Skeleton className="h-4 w-24" />
      <Skeleton className="mt-3 h-7 w-72" />
      <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      <div className="mt-8 overflow-hidden rounded-lg border border-mist-200 bg-white">
        <div className="border-b border-mist-200 bg-mist-50 px-4 py-3">
          <Skeleton className="h-3 w-40" />
        </div>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-6 border-b border-mist-100 px-4 py-4 last:border-b-0">
            <Skeleton className="h-4 w-1/3" />
            <Skeleton className="h-4 w-16" />
            <Skeleton className="h-4 w-24" />
            <Skeleton className="ml-auto h-4 w-20" />
          </div>
        ))}
      </div>
      <span className="sr-only">Loading</span>
    </div>
  );
}
