import { NextResponse } from "next/server";
import { runDemoPipeline } from "@/demo/pipeline";

export const dynamic = "force-dynamic";

export function GET() {
  return NextResponse.json(runDemoPipeline());
}
