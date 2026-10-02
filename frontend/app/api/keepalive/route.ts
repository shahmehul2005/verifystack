import { NextResponse } from "next/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";

export const dynamic = 'force-dynamic'; 

export async function GET() {
  const supabase = createServiceClient();
  
  if (!supabase) {
    return NextResponse.json({ status: "error", error: "Supabase not configured" }, { status: 500 });
  }

  const { error } = await supabase
    .from('organizations')
    .select('id')
    .limit(1);

  if (error) {
    return NextResponse.json({ status: "error", error: error.message }, { status: 500 });
  }

  return NextResponse.json({ status: "ok", message: "Supabase kept alive!" });
}
