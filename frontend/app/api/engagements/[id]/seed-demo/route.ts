import { NextResponse } from "next/server";

export const runtime = "nodejs";

/** Synthetic fact seeding is disabled on the client-facing prototype. */
export async function POST() {
  return NextResponse.json(
    { ok: false, error: "Demo seeding is disabled. Upload and accept evidence instead." },
    { status: 410 }
  );
}
