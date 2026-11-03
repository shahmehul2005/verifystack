import { NextResponse } from "next/server";
import { runDemoPipeline } from "@verifystack/backend/fixtures/pipeline";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(runDemoPipeline());
}
