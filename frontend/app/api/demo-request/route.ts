import { NextResponse } from "next/server";
import { DemoRequestBody, sendDemoRequestEmail } from "@verifystack/backend/lib/email/demoRequest";
import { LIMITS } from "@verifystack/backend/lib/rateLimit";
import { clientIp, limitExceeded } from "@/lib/api";

/**
 * Public demo-request form on the landing page. Nothing is stored; the request
 * is emailed to DEMO_REQUEST_TO through Resend with the requester as reply-to.
 */
export async function POST(req: Request) {
  const ipLimited = limitExceeded(`demo-request:ip:${clientIp(req)}`, LIMITS.demoRequestPerIp);
  if (ipLimited) return ipLimited;

  const parsed = DemoRequestBody.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Enter your name, a valid work email, your firm and a scheme." },
      { status: 400 }
    );
  }

  if (parsed.data.website) {
    return NextResponse.json({ ok: true });
  }

  const email = parsed.data.email.toLowerCase();
  const emailLimited = limitExceeded(`demo-request:email:${email}`, LIMITS.demoRequestPerEmail);
  if (emailLimited) return emailLimited;

  const result = await sendDemoRequestEmail({ ...parsed.data, email });
  if (result === "not_configured") {
    return NextResponse.json(
      { ok: false, error: "Demo requests are not available right now. Please try again later." },
      { status: 503 }
    );
  }
  if (result === "failed") {
    return NextResponse.json(
      { ok: false, error: "We could not send your request. Please try again in a few minutes." },
      { status: 502 }
    );
  }
  return NextResponse.json({ ok: true });
}
