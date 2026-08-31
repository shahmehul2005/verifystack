"use client";

import { ErrorState } from "@/components/states";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-3">
      <ErrorState title="Workbench error" body={error.message} />
      <button type="button" className="text-sm underline" onClick={reset}>
        Try again
      </button>
    </div>
  );
}
