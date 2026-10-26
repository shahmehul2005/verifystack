import { cache } from "react";
import { getSession as getSessionUncached } from "@verifystack/backend/lib/auth/getSession";
import { getEngagement as getEngagementUncached } from "@verifystack/backend/lib/data/engagements";

/**
 * Per-request memoisation for Server Components.
 *
 * App shell, engagement layout and each page all need the session and often the
 * same engagement. Without this, one click pays auth.getUser() and the
 * memberships query three times. React.cache lasts for a single render only;
 * it does not change authorisation, and API routes still call the uncached
 * helpers through requireCapability.
 */
export const getSession = cache(getSessionUncached);

export const getEngagement = cache(getEngagementUncached);
