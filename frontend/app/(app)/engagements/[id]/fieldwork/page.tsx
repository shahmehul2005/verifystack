import { notFound } from "next/navigation";
import { ConfigureSupabase, EmptyState, ForbiddenState } from "@/components/states";
import { PageHeader } from "@/components/page-header";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { getSession } from "@/lib/session";
import { hasCapability } from "@verifystack/backend/lib/auth/capabilities";
import { isSupabaseConfigured } from "@verifystack/backend/lib/supabase/configured";
import { getEngagement } from "@/lib/session";
import { createServerSupabase } from "@verifystack/backend/lib/supabase/server";
import { createServiceClient } from "@verifystack/backend/lib/supabase/admin";
import { canStartWork, loadPack, packFieldTargets } from "@verifystack/backend/domain/packs";
import { OBSERVATION_KIND_LABEL, captureDelayHours } from "@verifystack/backend/domain/fieldwork/observation";
import { PlanContentSchema } from "@verifystack/backend/domain/planning/plan";
import { formatIst, humanize } from "@/lib/format";
import { CaptureForm } from "./capture-form";
import { ScheduleVisit, VisitStatusButtons } from "./visits-panel";

export const metadata = { title: "Fieldwork" };

export default async function FieldworkPage({ params }: { params: Promise<{ id: string }> }) {
  if (!isSupabaseConfigured()) return <ConfigureSupabase />;
  const { id } = await params;
  const session = await getSession();
  if (!session?.organizationId) return <ForbiddenState />;
  if (!hasCapability(session.role, "fieldwork.record")) {
    return <ForbiddenState body="Fieldwork is recorded by verifiers and the lead verifier." />;
  }
  const engagement = await getEngagement(id, session.organizationId);
  if (!engagement) notFound();
  const pack = loadPack(engagement.pack_id);
  const canPlan = hasCapability(session.role, "plan.manage");

  const db = createServiceClient() ?? (await createServerSupabase());
  const [{ data: visits }, { data: observations }, { data: members }, { data: plans }] = await Promise.all([
    db!
      .from("site_visits")
      .select("*")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .order("created_at", { ascending: false }),
    db!
      .from("site_observations")
      .select("*")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .order("observed_at", { ascending: false })
      .limit(100),
    db!
      .from("memberships")
      .select("user_id, display_name, role")
      .eq("organization_id", session.organizationId),
    db!
      .from("verification_plans")
      .select("content, status, version")
      .eq("engagement_id", id)
      .eq("organization_id", session.organizationId)
      .eq("status", "approved")
      .order("version", { ascending: false })
      .limit(1),
  ]);

  const nameOf = new Map((members ?? []).map((m) => [m.user_id, m.display_name ?? humanize(m.role)]));
  const open = (visits ?? []).filter((v) => v.status === "planned" || v.status === "in_progress");
  const planContent = plans?.[0] ? PlanContentSchema.safeParse(plans[0].content) : null;
  const suggestions = planContent?.success
    ? planContent.data.visits.map((v) => ({ plannedFor: v.plannedFor, location: v.location, scope: v.scope }))
    : [];
  const visitLabel = new Map((visits ?? []).map((v) => [v.id, `${v.location}${v.planned_for ? ` (${v.planned_for})` : ""}`]));

  return (
    <>
      <PageHeader
        title="Fieldwork"
        description="Record what you saw on site: a meter reading, a nameplate, a process note, an interview, a photograph. A reading that names a field becomes a proposed value; because you recorded it, someone else has to accept it as a fact."
        meta={
          <span className="text-xs text-mist-500">
            Works without a signal. Observations queue on this device and sync when you are online.
          </span>
        }
      />

      {!canStartWork(pack) ? (
        <Alert tone="warn" className="mb-6" title="This pack is not runnable yet">
          Fieldwork can be recorded, but values from it cannot feed a calculation until the pack is runnable.
        </Alert>
      ) : null}

      <Card className="mb-6">
        <CardHeader title="Record an observation" />
        <CardBody>
          <CaptureForm
            engagementId={id}
            visits={open.map((v) => ({ id: v.id, label: visitLabel.get(v.id) ?? v.location }))}
            targets={packFieldTargets(pack)}
          />
        </CardBody>
      </Card>

      <Card className="mb-6">
        <CardHeader title="Site visits" description="A visit groups observations. A finished or cancelled visit takes no more." />
        <CardBody>
          {canPlan ? (
            <div className="mb-5 border-b border-mist-100 pb-5">
              <ScheduleVisit
                engagementId={id}
                suggestions={suggestions}
                members={(members ?? [])
                  .filter((m) => m.role !== "firm_admin")
                  .map((m) => ({ userId: m.user_id, name: m.display_name ?? humanize(m.role) }))}
              />
            </div>
          ) : null}
          {!visits?.length ? (
            <p className="text-[13px] text-mist-600">No visits scheduled.</p>
          ) : (
            <ul className="divide-y divide-mist-100 text-[13px]">
              {visits.map((v) => (
                <li key={v.id} className="flex flex-wrap items-center gap-3 py-2">
                  <span className="font-medium">{v.location}</span>
                  <Badge tone={v.status === "completed" ? "ok" : v.status === "cancelled" ? "neutral" : "ink"}>
                    {humanize(v.status)}
                  </Badge>
                  {v.planned_for ? <span className="text-mist-600">{v.planned_for}</span> : null}
                  {v.assigned_to ? (
                    <span className="text-mist-600">{nameOf.get(v.assigned_to) ?? "Assigned"}</span>
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-mist-500" title={v.scope}>
                    {v.scope}
                  </span>
                  <VisitStatusButtons engagementId={id} visitId={v.id} status={v.status} />
                </li>
              ))}
            </ul>
          )}
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title="Recorded observations"
          description="Device time is when it was seen; recorded time is when the server received it. A long gap is shown."
        />
        <CardBody>
          {!observations?.length ? (
            <EmptyState title="No observations yet" body="Record the first one above." />
          ) : (
            <div className="overflow-x-auto">
              <table className="min-w-full text-[13px]">
                <thead className="text-left text-xs text-mist-600">
                  <tr>
                    <th className="py-2 pr-3 font-medium">Observation</th>
                    <th className="py-2 pr-3 font-medium">Observer</th>
                    <th className="py-2 pr-3 font-medium">Seen</th>
                    <th className="py-2 pr-3 font-medium">Recorded</th>
                    <th className="py-2 pr-3 font-medium">Visit</th>
                    <th className="py-2 font-medium">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {observations.map((o) => {
                    const delay = captureDelayHours(Date.parse(o.observed_at), new Date(o.recorded_at));
                    return (
                      <tr key={o.id} className="border-t border-mist-100 align-top">
                        <td className="py-2 pr-3">
                          <span className="font-medium">{OBSERVATION_KIND_LABEL[o.kind]}</span>
                          {o.field_path ? <span className="ml-1 font-mono text-xs">{o.field_path}</span> : null}
                          {o.value_json !== null ? (
                            <span className="ml-1 tabular">
                              {String(o.value_json)} {o.unit ?? ""}
                            </span>
                          ) : null}
                          {o.note ? <span className="block max-w-md text-xs text-mist-600">{o.note}</span> : null}
                          {o.lat !== null ? (
                            <span className="block text-xs text-mist-500">
                              {o.lat.toFixed(4)}, {o.lng?.toFixed(4)}
                              {o.accuracy_m ? ` ±${Math.round(o.accuracy_m)} m` : ""}
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3">{o.observer_name}</td>
                        <td className="whitespace-nowrap py-2 pr-3 text-xs">{formatIst(o.observed_at)}</td>
                        <td className="whitespace-nowrap py-2 pr-3 text-xs">
                          {formatIst(o.recorded_at)}
                          {delay >= 1 ? (
                            <span className="block text-amber-700">{Math.round(delay)} h after capture</span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 text-xs">{o.visit_id ? (visitLabel.get(o.visit_id) ?? "—") : "—"}</td>
                        <td className="py-2">
                          {o.extracted_field_id ? (
                            <Badge tone="draft">Proposed value awaiting a second person</Badge>
                          ) : (
                            <Badge>Note only</Badge>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </>
  );
}
