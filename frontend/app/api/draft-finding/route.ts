import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError, limitExceeded } from "@/lib/api";
import { LIMITS } from "@verifystack/backend/lib/rateLimit";
import { polishCarDraft } from "@verifystack/backend/domain/ai/polishCar";
import type { RuleFinding } from "@verifystack/backend/domain/rules/types";

export const runtime = "nodejs";

const Finding = z.object({
  ruleId: z.string().max(40),
  severity: z.enum(["block", "warn", "info"]),
  title: z.string().max(500),
  detail: z.string().max(5000),
  clauseRef: z.string().max(1000),
  evidenceRefs: z.array(z.string().max(200)).max(100),
  magnitude: z.object({ value: z.number(), unit: z.string().max(40) }).optional(),
});

/**
 * Drafting a CAR spends money on a model, so it is authorised as the P6 action
 * it is. `/api/findings` no longer calls this over HTTP — it invokes
 * `polishCarDraft` in-process — but the route stays for direct callers.
 */
export async function POST(req: Request) {
  try {
    const session = await requireCapability("findings.decide");
    const limited = limitExceeded(`model:${session.user.id}`, LIMITS.modelCallsPerUser);
    if (limited) return limited;
    const body = Finding.safeParse(await req.json().catch(() => null));
    if (!body.success) {
      return NextResponse.json({ ok: false, error: "Invalid finding" }, { status: 400 });
    }
    const { draft, polished } = await polishCarDraft(body.data as RuleFinding);
    return NextResponse.json({ ok: true, draft, polished });
  } catch (e) {
    return jsonError(e);
  }
}
