"use client";

import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";

/**
 * Soft refresh after a mutation: re-runs Server Components for the current
 * route without a full browser reload.
 *
 * `isRefreshing` stays true until the refreshed RSC payload has landed, so
 * buttons can keep their loading state across the gap after `fetch` returns.
 */
export function useSoftReload() {
  const router = useRouter();
  const [isRefreshing, startTransition] = useTransition();

  const softReload = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);

  return { softReload, isRefreshing };
}
