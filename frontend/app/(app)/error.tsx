"use client";

import { ErrorState } from "@/components/states";
import { Button } from "@/components/ui/button";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="space-y-4">
      <ErrorState title="This page could not be loaded" body={error.message} />
      <Button variant="secondary" onClick={reset}>
        Try again
      </Button>
    </div>
  );
}
