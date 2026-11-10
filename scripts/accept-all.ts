import { config } from "dotenv";
config({ path: "frontend/.env.local" });
config({ path: ".env" });

import { createServiceClient } from "../backend/lib/supabase/admin";
import { carriedRegistryColumns } from "../backend/domain/registry/annotate";

async function acceptAllForEngagement(engagementId: string) {
  const admin = createServiceClient();
  if (!admin) throw new Error("No supabase admin client");

  const { data: eng, error: engErr } = await admin
    .from("engagements")
    .select("id, client_name, organization_id")
    .eq("id", engagementId)
    .single();

  if (engErr || !eng) {
    console.error(`Engagement ${engagementId} not found:`, engErr?.message);
    return;
  }

  console.log(`\n======================================================`);
  console.log(`Accepting all for: ${eng.client_name} (${eng.id})`);
  console.log(`======================================================`);

  // Find a user in the org to attribute reviewed_by
  const { data: membership } = await admin
    .from("memberships")
    .select("user_id")
    .eq("organization_id", eng.organization_id)
    .limit(1)
    .maybeSingle();

  let reviewerId = membership?.user_id;
  if (!reviewerId) {
    const { data: listData } = await admin.auth.admin.listUsers({ page: 1, perPage: 5 });
    reviewerId = listData?.users?.[0]?.id;
  }

  if (!reviewerId) {
    throw new Error(`No auth user found for organization ${eng.organization_id} or in auth.users`);
  }

  console.log(`Reviewer user ID: ${reviewerId}`);
  const now = new Date().toISOString();

  // 1. Accept all CEVs
  const { data: updatedCevs, error: cevErr } = await admin
    .from("canonical_evidence_values")
    .update({
      state: "accepted",
      reviewed_by: reviewerId,
      reviewed_at: now,
    })
    .eq("engagement_id", engagementId)
    .in("state", ["suggested", "pending_review"])
    .select("id");

  if (cevErr) {
    console.error("Error accepting CEVs:", cevErr.message);
  } else {
    console.log(`✓ Accepted ${updatedCevs?.length ?? 0} Canonical Evidence Values (CEVs)`);
  }

  // 2. Accept all extracted fields
  const { data: fieldsToAccept, error: fFetchErr } = await admin
    .from("extracted_fields")
    .select("*")
    .eq("engagement_id", engagementId)
    .in("state", ["suggested", "pending_review"]);

  if (fFetchErr || !fieldsToAccept) {
    console.error("Error fetching extracted fields:", fFetchErr?.message);
    return;
  }

  const { error: fUpdateErr } = await admin
    .from("extracted_fields")
    .update({
      state: "accepted",
      reviewed_by: reviewerId,
      reviewed_at: now,
      accept_mode: "bulk",
    })
    .eq("engagement_id", engagementId)
    .in("state", ["suggested", "pending_review"]);

  if (fUpdateErr) {
    console.error("Error updating extracted fields:", fUpdateErr.message);
  } else {
    console.log(`✓ Accepted ${fieldsToAccept.length} extracted fields`);
  }

  // 3. Insert into facts table for accepted fields that don't have facts yet
  const { data: existingFacts } = await admin
    .from("facts")
    .select("extracted_field_id")
    .eq("engagement_id", engagementId);

  const existingFieldIds = new Set((existingFacts ?? []).map((f) => f.extracted_field_id).filter(Boolean));
  const newFactsToInsert = fieldsToAccept
    .filter((f) => !existingFieldIds.has(f.id))
    .map((field) => ({
      organization_id: eng.organization_id,
      engagement_id: field.engagement_id,
      extracted_field_id: field.id,
      document_id: field.document_id,
      field_path: field.field_path,
      value_json: field.value_json,
      unit: field.unit,
      page: field.page,
      bbox: field.bbox,
      source_text: field.source_text,
      provenance_type: field.provenance_type ?? "document_page",
      provenance: field.provenance,
      accepted_by: reviewerId,
      accept_mode: "bulk",
      ...carriedRegistryColumns(field),
    }));

  if (newFactsToInsert.length > 0) {
    const { error: factErr } = await admin.from("facts").insert(newFactsToInsert);
    if (factErr) {
      console.error("Error inserting facts:", factErr.message);
    } else {
      console.log(`✓ Inserted ${newFactsToInsert.length} facts into facts ledger`);
    }
  } else {
    console.log(`- Facts already present for all fields (${existingFieldIds.size} facts)`);
  }
}

async function main() {
  const engagements = [
    "fde91ad1-c87e-4d99-b1ac-5fe7851fc928", // Shyamrock check
    "3fa1a19e-ecb0-412a-8ff2-9c3066f58046", // Himigri check
  ];

  for (const id of engagements) {
    await acceptAllForEngagement(id);
  }
}

main().catch(console.error);
