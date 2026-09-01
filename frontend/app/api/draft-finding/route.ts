import { NextResponse } from "next/server";
import { z } from "zod";
import { requireCapability } from "@verifystack/backend/lib/auth/requireRole";
import { jsonError } from "@/lib/api";
import { polishCarDraft } from "@verifystack/backend/domain/ai/polishCar";
import type { RuleFinding } from "@verifystack/backend/domain/rules/types";

export const runtime = "nodejs";

const Finding = z.object({
  ruleId: z.string(),
  severity: z.enum(["block", "warn", "info"]),
  title: z.string(),
  detail: z.string(),
  clauseRef: z.string(),
  evidenceRefs: z.array(z.string()),
  magnitude: z.object({ value: z.number(), unit: z.string() }).optional(),
});

/**
 * Drafting a CAR spends money on a model, so it is authorised as the P6 action
 * it is. `/api/findings` no longer calls this over HTTP — it invokes
 * `polishCarDraft` in-process — but the route stays for direct callers.
 */
export async function POST(req: Request) {
  try {
    await requireCapability("findings.decide");
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
