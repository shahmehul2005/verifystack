"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { listPacks, canStartWork } from "@verifystack/backend/domain/packs";
import type { MethodologyPack, PackScheme } from "@verifystack/backend/domain/packs";
import {
  CLUSTER_PROXIMITY_KM,
  ENTERPRISE_CATEGORIES,
  LOAN_MAX_INR,
  LOAN_MIN_INR,
  MAX_DEBT_FUNDING_PCT,
  SUBVENTION_PCT,
  computeSubvention,
  formatINR,
  type EnterpriseCategory,
} from "@verifystack/backend/domain/packs/adeetie";
import { CircleAlert, OctagonX, TriangleAlert } from "lucide-react";
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { FieldHint, Input, Label, Select } from "@/components/ui/input";
import { Alert } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Breadcrumbs } from "@/components/ui/breadcrumbs";
import { ErrorState } from "@/components/states";
import { cn } from "@/lib/cn";
import { currentFyLabel } from "@/lib/format";

const SCHEMES: PackScheme[] = ["CCTS", "ADEETIE"];

/** Sentinel for the explicit "outside every notified cluster" path. */
const NOT_NOTIFIED = "__not_notified__";

type Severity = "block" | "warn" | "info";

interface Check {
  ruleId: string;
  severity: Severity;
  title: string;
  detail: string;
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[,\s₹]/g, "");
  if (cleaned === "") return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

export function EngagementWizard() {
  const router = useRouter();
  const [scheme, setScheme] = useState<PackScheme>("CCTS");
  const [packId, setPackId] = useState("CCTS-CEMENT-v1");
  const [clientName, setClientName] = useState("");
  const [plantName, setPlantName] = useState("");
  const [complianceYear, setComplianceYear] = useState(currentFyLabel());
  const [geiTarget, setGeiTarget] = useState("0.82");

  const [clusterChoice, setClusterChoice] = useState("");
  const [distanceKm, setDistanceKm] = useState("");
  const [category, setCategory] = useState<EnterpriseCategory>("Micro");
  const [udyam, setUdyam] = useState("");
  const [loanAmount, setLoanAmount] = useState("");
  const [projectCost, setProjectCost] = useState("");
  const [sanctionedRate, setSanctionedRate] = useState("");

  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const packs = useMemo(() => listPacks({ scheme }), [scheme]);
  const selected: MethodologyPack | undefined =
    packs.find((p) => p.pack_id === packId) ?? packs[0];
  const runnable = selected ? canStartWork(selected) : false;
  const isAdeetie = scheme === "ADEETIE";
  const clusters = selected?.adeetie?.clusters ?? [];
  const notInNotifiedCluster = clusterChoice === NOT_NOTIFIED;

  const loanINR = parseAmount(loanAmount);
  const projectINR = parseAmount(projectCost);
  const ratePct = parseAmount(sanctionedRate);
  const distance = parseAmount(distanceKm);

  const checks = useMemo<Check[]>(() => {
    if (!isAdeetie || !selected) return [];
    const out: Check[] = [];
    const sector = selected.sector_or_cluster;

    // AD-ELG001 — Udyam registration.
    const udyamValue = udyam.trim();
    if (!udyamValue) {
      out.push({
        ruleId: "AD-ELG001",
        severity: "block",
        title: "MSME Udyam registration not evidenced",
        detail:
          "No Udyam Registration Number is recorded. The scheme is open to Udyam-registered MSMEs.",
      });
    } else if (!/^UDYAM-[A-Z]{2}-\d{2}-\d{7}$/i.test(udyamValue)) {
      out.push({
        ruleId: "AD-ELG001",
        severity: "warn",
        title: "Udyam Registration Number does not match the printed format",
        detail:
          `"${udyamValue}" does not match the UDYAM-<STATE>-<DD>-<NNNNNNN> form printed on the ` +
          `certificate. This system does not verify registrations against the Udyam portal.`,
      });
    }

    // AD-ELG002 — cluster eligibility.
    if (!clusterChoice) {
      out.push({
        ruleId: "AD-ELG002",
        severity: "block",
        title: "No cluster recorded",
        detail: `Pick the notified ${sector} cluster the enterprise operates in, or record explicitly that it is outside every notified cluster.`,
      });
    } else if (notInNotifiedCluster) {
      if (distance === null) {
        out.push({
          ruleId: "AD-ELG002",
          severity: "block",
          title: "Enterprise is not in a notified cluster",
          detail:
            `The enterprise is recorded as outside the ${sector} notified cluster list and no distance ` +
            `to a notified cluster has been claimed.`,
        });
      } else if (distance <= CLUSTER_PROXIMITY_KM) {
        out.push({
          ruleId: "AD-ELG002",
          severity: "warn",
          title: "Eligibility rests on the 200 km proximity provision",
          detail:
            `A claimed ${distance} km to the nearest notified cluster is within the ` +
            `${CLUSTER_PROXIMITY_KM} km provision. This system holds no notified cluster boundary ` +
            `geometry and has neither computed nor confirmed that distance. It is a reviewable ` +
            `exception that must be evidenced and accepted by a reviewer — it does not pass ` +
            `automatically.`,
        });
      } else {
        out.push({
          ruleId: "AD-ELG002",
          severity: "block",
          title: "Claimed distance exceeds the proximity provision",
          detail: `A claimed ${distance} km is beyond the ${CLUSTER_PROXIMITY_KM} km provision.`,
        });
      }
    } else {
      out.push({
        ruleId: "AD-ELG002",
        severity: "info",
        title: "Confirm cluster against the published BEE list",
        detail:
          `"${clusterChoice}" matches a row in the ${sector} cluster list held by this system. ` +
          `Confirm it against the official BEE notified-cluster list before relying on it.`,
      });
    }

    // AD-ELG003 — loan size window.
    if (loanINR === null) {
      out.push({
        ruleId: "AD-ELG003",
        severity: "block",
        title: "Loan amount not recorded",
        detail: `The eligible range is ${formatINR(LOAN_MIN_INR)} to ${formatINR(LOAN_MAX_INR)}.`,
      });
    } else if (loanINR < LOAN_MIN_INR || loanINR > LOAN_MAX_INR) {
      out.push({
        ruleId: "AD-ELG003",
        severity: "block",
        title: "Loan amount outside the eligible range",
        detail:
          `Loan amount ${formatINR(loanINR)} is ${loanINR < LOAN_MIN_INR ? "below the minimum" : "above the maximum"} ` +
          `of the eligible range ${formatINR(LOAN_MIN_INR)} to ${formatINR(LOAN_MAX_INR)}.`,
      });
    }

    // AD-ELG004 — debt share of project cost.
    if (projectINR === null || projectINR <= 0) {
      out.push({
        ruleId: "AD-ELG004",
        severity: "block",
        title: "Project cost is not stated",
        detail: "Without a project cost the debt share cannot be computed.",
      });
    } else if (loanINR !== null) {
      const sharePct = (loanINR / projectINR) * 100;
      if (sharePct > MAX_DEBT_FUNDING_PCT) {
        const qualifying = (projectINR * MAX_DEBT_FUNDING_PCT) / 100;
        out.push({
          ruleId: "AD-ELG004",
          severity: "block",
          title: "Debt funding exceeds the qualifying share of project cost",
          detail:
            `A loan of ${formatINR(loanINR)} against a project cost of ${formatINR(projectINR)} is ` +
            `${sharePct.toFixed(2)}% debt funding, above the ${MAX_DEBT_FUNDING_PCT}% that qualifies. ` +
            `At this project cost, ${formatINR(qualifying)} qualifies.`,
        });
      } else {
        out.push({
          ruleId: "AD-ELG004",
          severity: "info",
          title: "Debt share is within the qualifying limit",
          detail:
            `${sharePct.toFixed(2)}% of project cost is met by the loan, against a ${MAX_DEBT_FUNDING_PCT}% limit.`,
        });
      }
    }

    // AD-ELG005 — subvention against the enterprise category.
    if (ratePct !== null && loanINR !== null) {
      const computed = computeSubvention({
        category,
        sanctionedRatePct: ratePct,
        principalINR: loanINR,
      });
      if (computed.cappedByNetRateFloor) {
        out.push({
          ruleId: "AD-ELG005",
          severity: "warn",
          title: "Subvention is capped by the minimum net borrowing rate",
          detail:
            `${computed.notes.join(" ")} The applicable subvention is ${computed.appliedSubventionPct}%, ` +
            `not the headline ${computed.headlineSubventionPct}%, leaving a net borrowing rate of ` +
            `${computed.netBorrowingRatePct}%.`,
        });
      } else {
        out.push({
          ruleId: "AD-ELG005",
          severity: "info",
          title: "Interest subvention as computed",
          detail:
            `A ${category} enterprise is entitled to ${SUBVENTION_PCT[category]}%. At a sanctioned rate of ` +
            `${ratePct}% the applied subvention is ${computed.appliedSubventionPct}%, leaving a net ` +
            `borrowing rate of ${computed.netBorrowingRatePct}% and annual relief of ` +
            `${formatINR(computed.annualReliefINR)}.`,
        });
      }
    }

    return out;
  }, [
    isAdeetie,
    selected,
    udyam,
    clusterChoice,
    notInNotifiedCluster,
    distance,
    loanINR,
    projectINR,
    ratePct,
    category,
  ]);

  const blocking = checks.filter((c) => c.severity === "block");

  async function onSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selected) return;
    setPending(true);
    setError(null);

    const cluster = notInNotifiedCluster ? null : clusterChoice || null;
    const clusterState = cluster
      ? (clusters.find((c) => c.cluster === cluster)?.state ?? null)
      : null;

    const res = await fetch("/api/engagements", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        packId: selected.pack_id,
        clientName,
        plantName,
        complianceYear,
        geiTarget: !isAdeetie && geiTarget ? Number(geiTarget) : null,
        ...(isAdeetie
          ? {
              adeetieCluster: cluster,
              adeetieState: clusterState,
              enterpriseCategory: category,
              udyamRegistrationNo: udyam.trim() || null,
              loanAmountInr: loanINR,
              projectCostInr: projectINR,
              sanctionedInterestRatePct: ratePct,
              claimedDistanceToClusterKm: notInNotifiedCluster ? distance : null,
            }
          : {}),
      }),
    });
    const json = await res.json();
    setPending(false);
    if (!res.ok || !json.ok) {
      setError(json.error ?? "Could not create engagement");
      return;
    }
    router.push(`/engagements/${json.engagement.id}`);
  }

  const detailsStep = isAdeetie ? 3 : 2;

  return (
    <form onSubmit={onSubmit}>
      <div className="mb-4">
        <Breadcrumbs items={[{ label: "Engagements", href: "/engagements" }, { label: "New engagement" }]} />
      </div>
      <PageHeader
        title="New engagement"
        description="Choose the scheme and the sector pack, then record who the work is for. The pack is fixed once the engagement is created."
      />

      <div
        className={cn(
          "grid gap-6",
          isAdeetie ? "lg:grid-cols-[minmax(0,1fr)_22rem]" : "max-w-3xl"
        )}
      >
        <div className="min-w-0 space-y-5">
          {error ? <ErrorState title="Could not create the engagement" body={error} /> : null}

          <WizardSection step={1} title="Scheme and methodology pack">
            <fieldset>
              <legend className="mb-1.5 block text-[13px] font-medium text-mist-800">Scheme</legend>
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Scheme">
                {SCHEMES.map((s) => {
                  const active = scheme === s;
                  return (
                    <button
                      key={s}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      onClick={() => {
                        setScheme(s);
                        const next = listPacks({ scheme: s })[0];
                        setPackId(next?.pack_id ?? "");
                        setClusterChoice("");
                        setDistanceKm("");
                      }}
                      className={cn(
                        "rounded-lg border px-4 py-3 text-left transition-colors",
                        active
                          ? "border-teal-600 bg-teal-50/60 ring-1 ring-teal-600"
                          : "border-mist-200 bg-white hover:border-mist-300 hover:bg-mist-50"
                      )}
                    >
                      <span className="flex items-center justify-between">
                        <span className="text-sm font-semibold text-mist-950">{s}</span>
                        <span
                          aria-hidden
                          className={cn(
                            "size-4 rounded-full border",
                            active ? "border-[5px] border-teal-700" : "border-mist-300"
                          )}
                        />
                      </span>
                      <span className="mt-1 block text-xs leading-relaxed text-mist-600">
                        {SCHEME_BLURB[s]}
                      </span>
                    </button>
                  );
                })}
              </div>
            </fieldset>

            <div className="mt-5">
              <Label htmlFor="pack">Sector pack</Label>
              <Select
                id="pack"
                value={selected?.pack_id ?? ""}
                onChange={(e) => {
                  setPackId(e.target.value);
                  setClusterChoice("");
                }}
              >
                {packs.map((p) => (
                  <option key={p.pack_id} value={p.pack_id}>
                    {p.sector_or_cluster} — {p.pack_id}
                    {p.status === "runnable" ? "" : " (not yet runnable)"}
                  </option>
                ))}
              </Select>
              {selected && !runnable ? (
                <Alert tone="warn" className="mt-3" title="This pack is not yet runnable">
                  You can record the engagement in setup, but intake, extraction and calculation
                  stay disabled. {selected.notes}
                </Alert>
              ) : null}
            </div>
          </WizardSection>

          {isAdeetie && selected ? (
            <WizardSection
              step={2}
              title="ADEETIE eligibility"
              description="Every parameter below is compiled from the BEE ADEETIE scheme description and is marked TO VERIFY against the operative scheme guidelines. Nothing recorded here is an eligibility decision."
            >
              <AdeetieFields
                pack={selected}
                clusters={clusters}
                clusterChoice={clusterChoice}
                setClusterChoice={setClusterChoice}
                distanceKm={distanceKm}
                setDistanceKm={setDistanceKm}
                category={category}
                setCategory={setCategory}
                udyam={udyam}
                setUdyam={setUdyam}
                loanAmount={loanAmount}
                setLoanAmount={setLoanAmount}
                projectCost={projectCost}
                setProjectCost={setProjectCost}
                sanctionedRate={sanctionedRate}
                setSanctionedRate={setSanctionedRate}
                loanINR={loanINR}
                projectINR={projectINR}
              />
            </WizardSection>
          ) : null}

          <WizardSection step={detailsStep} title={isAdeetie ? "Enterprise and baseline" : "Client and compliance year"}>
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <Label htmlFor="client">
                  {isAdeetie ? "Enterprise (applicant)" : "Obligated entity (client)"}
                </Label>
                <Input
                  id="client"
                  value={clientName}
                  onChange={(e) => setClientName(e.target.value)}
                  required
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="plant">Plant or installation</Label>
                <Input
                  id="plant"
                  value={plantName}
                  onChange={(e) => setPlantName(e.target.value)}
                  placeholder="Optional"
                />
              </div>
              <div>
                <Label htmlFor="fy">{isAdeetie ? "Baseline year" : "Compliance year"}</Label>
                <Input
                  id="fy"
                  value={complianceYear}
                  onChange={(e) => setComplianceYear(e.target.value)}
                  required
                />
                <FieldHint>Indian financial year, e.g. {currentFyLabel()}</FieldHint>
              </div>
              {!isAdeetie ? (
                <div>
                  <Label htmlFor="gei">Notified GEI target</Label>
                  <Input
                    id="gei"
                    inputMode="decimal"
                    value={geiTarget}
                    onChange={(e) => setGeiTarget(e.target.value)}
                  />
                  <FieldHint>Optional. Leave blank if the target is not yet notified.</FieldHint>
                </div>
              ) : null}
            </div>
          </WizardSection>

          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-mist-200 bg-white px-5 py-4 shadow-xs">
            <Button type="submit" size="lg" disabled={pending || !clientName}>
              {pending ? "Creating…" : "Create engagement"}
            </Button>
            {!runnable ? <Badge tone="draft">Work cannot start on this pack yet</Badge> : null}
            {blocking.length > 0 ? (
              <Badge tone="block" dot>
                {blocking.length} eligibility {blocking.length === 1 ? "gate" : "gates"} not met
              </Badge>
            ) : null}
            {isAdeetie && blocking.length > 0 ? (
              <p className="basis-full text-xs leading-relaxed text-mist-600">
                You can still create the engagement: an out-of-range value has to be recordable to
                be found. The rules engine re-checks these gates against the evidence, and an open
                blocking finding stops sign-off.
              </p>
            ) : null}
          </div>
        </div>

        {isAdeetie ? (
          <aside className="lg:sticky lg:top-20 lg:self-start">
            {checks.length > 0 ? <ChecksPanel checks={checks} /> : null}
          </aside>
        ) : null}
      </div>
    </form>
  );
}

const SCHEME_BLURB: Record<PackScheme, string> = {
  CCTS: "Carbon Credit Trading Scheme. Greenhouse-gas intensity against a notified target.",
  ADEETIE: "BEE scheme for MSMEs. Energy audit, DPR and measured savings in three phases.",
  CBAM: "Embedded emissions for EU exports. Structure only; no engagement can be started.",
  GREEN_HYDROGEN: "Green hydrogen carbon intensity. Structure only; no engagement can be started.",
};

function WizardSection({
  step,
  title,
  description,
  children,
}: {
  step: number;
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="rounded-lg border border-mist-200 bg-white shadow-xs">
      <header className="flex gap-3 border-b border-mist-100 px-5 py-4">
        <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-teal-700 text-xs font-semibold text-white">
          {step}
        </span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold text-mist-950">{title}</h2>
          {description ? (
            <p className="mt-0.5 max-w-2xl text-[13px] leading-relaxed text-mist-600">{description}</p>
          ) : null}
        </div>
      </header>
      <div className="px-5 py-5">{children}</div>
    </section>
  );
}

function AdeetieFields({
  pack,
  clusters,
  clusterChoice,
  setClusterChoice,
  distanceKm,
  setDistanceKm,
  category,
  setCategory,
  udyam,
  setUdyam,
  loanAmount,
  setLoanAmount,
  projectCost,
  setProjectCost,
  sanctionedRate,
  setSanctionedRate,
  loanINR,
  projectINR,
}: {
  pack: MethodologyPack;
  clusters: { state: string; cluster: string }[];
  clusterChoice: string;
  setClusterChoice: (v: string) => void;
  distanceKm: string;
  setDistanceKm: (v: string) => void;
  category: EnterpriseCategory;
  setCategory: (v: EnterpriseCategory) => void;
  udyam: string;
  setUdyam: (v: string) => void;
  loanAmount: string;
  setLoanAmount: (v: string) => void;
  projectCost: string;
  setProjectCost: (v: string) => void;
  sanctionedRate: string;
  setSanctionedRate: (v: string) => void;
  loanINR: number | null;
  projectINR: number | null;
}) {
  const notNotified = clusterChoice === NOT_NOTIFIED;
  return (
    <div className="space-y-5">
      <div>
        <Label htmlFor="cluster">Notified cluster ({pack.sector_or_cluster})</Label>
        <Select
          id="cluster"
          value={clusterChoice}
          onChange={(e) => setClusterChoice(e.target.value)}
        >
          <option value="">Select a cluster…</option>
          {clusters.map((c) => (
            <option key={`${c.state}-${c.cluster}`} value={c.cluster}>
              {c.cluster} — {c.state}
            </option>
          ))}
          <option value={NOT_NOTIFIED}>Not in a notified cluster</option>
        </Select>
        {pack.adeetie && !pack.adeetie.clustersVerified ? (
          <Alert tone="warn" className="mt-3" title="This cluster list is unverified">
            {pack.adeetie.clusters.length}{" "}
            {pack.adeetie.clusters.length === 1 ? "row is" : "rows are"} held for{" "}
            {pack.sector_or_cluster} and none has been read back against the official BEE list.
          </Alert>
        ) : null}
        {notNotified ? (
          <div className="mt-4">
            <Label htmlFor="distance">Claimed distance to the nearest notified cluster (km)</Label>
            <Input
              id="distance"
              inputMode="decimal"
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
              placeholder="e.g. 45"
            />
            <FieldHint>
              A claimed distance is evidence to be checked, not a computation. This system holds no
              notified cluster boundary geometry, so it cannot confirm the figure. A distance inside{" "}
              {CLUSTER_PROXIMITY_KM} km raises a reviewable exception; it does not pass
              automatically.
            </FieldHint>
          </div>
        ) : null}
      </div>

      <fieldset>
        <legend className="mb-1.5 block text-[13px] font-medium text-mist-800">
          Enterprise category
        </legend>
        <div className="inline-flex flex-wrap rounded-md border border-mist-300 bg-white p-0.5 shadow-xs" role="radiogroup" aria-label="Enterprise category">
          {ENTERPRISE_CATEGORIES.map((c) => {
            const active = category === c;
            return (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => setCategory(c)}
                className={cn(
                  "h-8 rounded-[5px] px-3 text-[13px] font-medium transition-colors",
                  active ? "bg-teal-700 text-white" : "text-mist-700 hover:bg-mist-100"
                )}
              >
                {c}
                <span className={cn("ml-1.5 text-xs tabular", active ? "text-teal-100" : "text-mist-500")}>
                  {SUBVENTION_PCT[c]}%
                </span>
              </button>
            );
          })}
        </div>
        <FieldHint>
          Sets the headline interest subvention rate and the audit cost reimbursement cap.
        </FieldHint>
      </fieldset>

      <div>
        <Label htmlFor="udyam">Udyam Registration Number</Label>
        <Input
          id="udyam"
          className="font-mono"
          value={udyam}
          onChange={(e) => setUdyam(e.target.value)}
          placeholder="UDYAM-XX-00-0000000"
        />
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="loan">Loan amount (₹)</Label>
          <Input
            id="loan"
            inputMode="numeric"
            className="tabular"
            value={loanAmount}
            onChange={(e) => setLoanAmount(e.target.value)}
            placeholder={String(LOAN_MIN_INR)}
          />
          <FieldHint>
            {loanINR !== null ? (
              <span className="font-medium text-mist-700">{formatINR(loanINR)} · </span>
            ) : null}
            Eligible range {formatINR(LOAN_MIN_INR)} to {formatINR(LOAN_MAX_INR)}
          </FieldHint>
        </div>
        <div>
          <Label htmlFor="cost">Project cost (₹)</Label>
          <Input
            id="cost"
            inputMode="numeric"
            className="tabular"
            value={projectCost}
            onChange={(e) => setProjectCost(e.target.value)}
          />
          <FieldHint>
            {projectINR !== null ? (
              <span className="font-medium text-mist-700">{formatINR(projectINR)} · </span>
            ) : null}
            Up to {MAX_DEBT_FUNDING_PCT}% may be met by qualifying debt
          </FieldHint>
        </div>
      </div>

      <div className="sm:max-w-[calc(50%-0.5rem)]">
        <Label htmlFor="rate">Sanctioned interest rate (% a year)</Label>
        <Input
          id="rate"
          inputMode="decimal"
          className="tabular"
          value={sanctionedRate}
          onChange={(e) => setSanctionedRate(e.target.value)}
        />
        <FieldHint>Optional.</FieldHint>
      </div>
    </div>
  );
}

const SEVERITY: Record<
  Severity,
  { label: string; tone: "block" | "draft" | "neutral"; icon: typeof CircleAlert; iconClass: string }
> = {
  block: { label: "Blocks", tone: "block", icon: OctagonX, iconClass: "text-red-600" },
  warn: { label: "Review", tone: "draft", icon: TriangleAlert, iconClass: "text-amber-600" },
  info: { label: "Note", tone: "neutral", icon: CircleAlert, iconClass: "text-teal-700" },
};

function ChecksPanel({ checks }: { checks: Check[] }) {
  return (
    <section className="rounded-lg border border-mist-200 bg-white shadow-xs">
      <header className="border-b border-mist-100 px-4 py-3">
        <h2 className="text-sm font-semibold text-mist-950">Eligibility checks</h2>
        <p className="mt-0.5 text-xs text-mist-500">Updated as you type. Stated as the rules engine states them.</p>
      </header>
      <ul className="divide-y divide-mist-100">
        {checks.map((c, i) => {
          const s = SEVERITY[c.severity];
          const Icon = s.icon;
          return (
            <li key={`${c.ruleId}-${i}`} className="flex gap-2.5 px-4 py-3 text-[13px]">
              <Icon aria-hidden className={cn("mt-0.5 size-4 shrink-0", s.iconClass)} />
              <div className="min-w-0">
                <p className="font-medium leading-snug text-mist-900">{c.title}</p>
                <p className="mt-1 text-xs leading-relaxed text-mist-600">{c.detail}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  <Badge tone={s.tone}>{s.label}</Badge>
                  <span className="font-mono text-xs text-mist-500">{c.ruleId}</span>
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
