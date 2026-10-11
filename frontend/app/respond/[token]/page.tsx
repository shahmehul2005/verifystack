import type { Metadata } from "next";
import { Logo } from "@/components/brand/logo";
import { Alert } from "@/components/ui/alert";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatIst } from "@/lib/format";
import { resolveResponseLink } from "@verifystack/backend/lib/data/entityResponse";
import { RespondForm } from "./respond-form";

export const metadata: Metadata = {
  title: "Respond to a verification query",
  robots: { index: false, follow: false },
};

// The link's validity changes the moment it is used or revoked.
export const dynamic = "force-dynamic";

export default async function RespondPage({ params }: { params: Promise<{ token: string }> }) {
  const { token: raw } = await params;
  const token = decodeURIComponent(raw);
  const resolved = await resolveResponseLink(token);

  return (
    <main className="min-h-screen">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:py-14">
        <div className="mb-8">
          <Logo />
        </div>

        {!resolved.ok ? (
          <Alert
            tone={resolved.reason === "unavailable" ? "warn" : "info"}
            title={
              resolved.reason === "unavailable"
                ? "This page is not available right now"
                : "This link is no longer active"
            }
          >
            {resolved.reason === "unavailable"
              ? "Try again in a few minutes."
              : "It may have been used already, replaced by a newer one, or have expired. Ask your verifier to send a new link."}
          </Alert>
        ) : (
          <Card className="p-6 sm:p-8">
            <p className="text-[13px] text-mist-600">
              {resolved.target.firmName} needs a response about{" "}
              <span className="font-medium text-mist-900">
                {resolved.target.engagement.client_name}
                {resolved.target.engagement.plant_name ? ` · ${resolved.target.engagement.plant_name}` : ""}
              </span>
            </p>

            <div className="mt-3 flex flex-wrap items-center gap-2">
              <h1 className="text-xl font-semibold tracking-tight text-mist-950">
                {resolved.target.finding.heading ?? resolved.target.finding.title}
              </h1>
              <Badge tone={resolved.target.finding.severity === "block" ? "block" : "draft"}>
                {resolved.target.finding.severity === "block" ? "Needs a response" : "Query"}
              </Badge>
            </div>

            <p className="mt-3 whitespace-pre-wrap text-sm leading-relaxed text-mist-800">
              {resolved.target.finding.body ?? resolved.target.finding.detail}
            </p>

            {resolved.target.finding.required_response ? (
              <div className="mt-4 rounded-md border border-teal-200 bg-teal-50/60 px-4 py-3 text-sm text-teal-950">
                <p className="text-[13px] font-medium">What is needed</p>
                <p className="mt-0.5 whitespace-pre-wrap leading-relaxed">
                  {resolved.target.finding.required_response}
                </p>
              </div>
            ) : null}

            <dl className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-mist-600">
              {resolved.target.finding.clause_ref ? (
                <div className="flex gap-1.5">
                  <dt>Reference</dt>
                  <dd className="font-medium text-mist-800">{resolved.target.finding.clause_ref}</dd>
                </div>
              ) : null}
              {resolved.target.finding.due_at ? (
                <div className="flex gap-1.5">
                  <dt>Please respond by</dt>
                  <dd className="font-medium text-mist-800">{formatIst(resolved.target.finding.due_at, false)}</dd>
                </div>
              ) : null}
            </dl>

            <hr className="my-6 border-mist-200" />
            <RespondForm token={token} />
          </Card>
        )}

        <p className="mt-6 text-center text-xs text-mist-500">
          This page was sent to you by your verifier. It shows only this one query and needs no account.
        </p>
      </div>
    </main>
  );
}
