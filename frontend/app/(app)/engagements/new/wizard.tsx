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
import { PageHeader } from "@/components/page-header";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ErrorState } from "@/components/states";
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
        title: "Cluster matched against an UNVERIFIED notified-cluster list",
        detail:
          `"${clusterChoice}" matches a row in the ${sector} cluster list held by this system. That ` +
          `list is flagged unverified — the official BEE cluster page has not been read back against ` +
          `it — so the match must be confirmed against the published list before it is relied on.`,
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

  return (
    <form onSubmit={onSubmit} className="max-w-3xl space-y-5">
      <PageHeader
        kicker="New engagement"
        title="Bind a methodology pack"
        description="Scheme → sector/cluster → pack. The pack cannot be rebound later."
      />
      {error ? <ErrorState body={error} /> : null}

      <fieldset>
        <Label>Scheme</Label>
        <div className="flex gap-2">
          {SCHEMES.map((s) => (
            <Button
              key={s}
              variant={scheme === s ? "primary" : "secondary"}
              onClick={() => {
                setScheme(s);
                const next = listPacks({ scheme: s })[0];
                setPackId(next?.pack_id ?? "");
                setClusterChoice("");
                setDistanceKm("");
              }}
            >
              {s}
            </Button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <Label htmlFor="pack">Pack (sector / cluster)</Label>
        <select
          id="pack"
          className="h-9 w-full border border-stone-300 bg-white px-2 text-sm"
          value={selected?.pack_id ?? ""}
          onChange={(e) => {
            setPackId(e.target.value);
            setClusterChoice("");
          }}
        >
          {packs.map((p) => (
            <option key={p.pack_id} value={p.pack_id}>
              {p.sector_or_cluster} — {p.pack_id} ({p.status})
            </option>
          ))}
        </select>
        {selected && !runnable ? (
          <p className="mt-2 border border-amber-400 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-950">
            This pack is a scaffold, so work cannot be started against it. You may record the
            engagement in setup; intake, extraction and calculation stay disabled.{" "}
            {selected.notes}
          </p>
        ) : null}
      </fieldset>

      {isAdeetie && selected ? (
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
      ) : null}

      <div>
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
      <div>
        <Label htmlFor="plant">Plant / installation</Label>
        <Input id="plant" value={plantName} onChange={(e) => setPlantName(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="fy">{isAdeetie ? "Baseline year" : "Compliance year"}</Label>
        <Input
          id="fy"
          value={complianceYear}
          onChange={(e) => setComplianceYear(e.target.value)}
          required
        />
      </div>
      {!isAdeetie ? (
        <div>
          <Label htmlFor="gei">Notified GEI target (optional)</Label>
          <Input
            id="gei"
            inputMode="decimal"
            value={geiTarget}
            onChange={(e) => setGeiTarget(e.target.value)}
          />
        </div>
      ) : null}

      {checks.length > 0 ? <ChecksPanel checks={checks} /> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={pending || !clientName}>
          Create engagement
        </Button>
        {!runnable ? <Badge tone="draft">Start work disabled</Badge> : null}
        {blocking.length > 0 ? (
          <Badge tone="block">{blocking.length} eligibility gate(s) not met</Badge>
        ) : null}
      </div>
      {isAdeetie && blocking.length > 0 ? (
        <p className="text-[12px] text-stone-600">
          The engagement can still be created — an out-of-range value must be recordable in order
          to be found. These gates are re-evaluated by the rules engine against the evidence, and
          an open block finding refuses sign-off.
        </p>
      ) : null}
    </form>
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
    <div className="space-y-5 border border-stone-300 bg-white p-4">
      <div>
        <p className="text-[11px] uppercase tracking-[0.18em] text-stone-500">
          ADEETIE eligibility
        </p>
        <p className="mt-1 text-[12px] text-stone-600">
          Every parameter below is compiled from the BEE ADEETIE scheme description and is marked
          TO VERIFY against the operative scheme guidelines. Nothing recorded here is an
          eligibility decision.
        </p>
      </div>

      <fieldset>
        <Label htmlFor="cluster">Notified cluster ({pack.sector_or_cluster})</Label>
        <select
          id="cluster"
          className="h-9 w-full border border-stone-300 bg-white px-2 text-sm"
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
        </select>
        {pack.adeetie && !pack.adeetie.clustersVerified ? (
          <p className="mt-2 border border-amber-400 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-950">
            This cluster list is UNVERIFIED. {pack.adeetie.clusters.length} row(s) are held for{" "}
            {pack.sector_or_cluster} and none has been read back against the official BEE list.
          </p>
        ) : null}
        {notNotified ? (
          <div className="mt-2 space-y-2">
            <Label htmlFor="distance">
              Claimed distance to the nearest notified cluster (km)
            </Label>
            <Input
              id="distance"
              inputMode="decimal"
              value={distanceKm}
              onChange={(e) => setDistanceKm(e.target.value)}
              placeholder="e.g. 45"
            />
            <p className="border border-amber-400 bg-amber-50 px-2.5 py-2 text-[12px] text-amber-950">
              A claimed distance is evidence to be checked, not a computation. This system holds no
              notified cluster boundary geometry, so it cannot confirm the figure. Recording a
              distance inside {CLUSTER_PROXIMITY_KM} km raises a reviewable exception — it is not
              an auto-pass.
            </p>
          </div>
        ) : null}
      </fieldset>

      <fieldset>
        <Label>Enterprise category</Label>
        <div className="flex flex-wrap gap-2">
          {ENTERPRISE_CATEGORIES.map((c) => (
            <Button
              key={c}
              size="sm"
              variant={category === c ? "primary" : "secondary"}
              onClick={() => setCategory(c)}
            >
              {c} · {SUBVENTION_PCT[c]}%
            </Button>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-stone-500">
          Drives the headline interest subvention rate and the audit cost reimbursement cap.
        </p>
      </fieldset>

      <div>
        <Label htmlFor="udyam">Udyam Registration Number</Label>
        <Input
          id="udyam"
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
            value={loanAmount}
            onChange={(e) => setLoanAmount(e.target.value)}
            placeholder={String(LOAN_MIN_INR)}
          />
          <p className="mt-1 text-[11px] text-stone-500">
            {loanINR !== null ? formatINR(loanINR) : "—"} · eligible range{" "}
            {formatINR(LOAN_MIN_INR)} to {formatINR(LOAN_MAX_INR)}
          </p>
        </div>
        <div>
          <Label htmlFor="cost">Project cost (₹)</Label>
          <Input
            id="cost"
            inputMode="numeric"
            value={projectCost}
            onChange={(e) => setProjectCost(e.target.value)}
          />
          <p className="mt-1 text-[11px] text-stone-500">
            {projectINR !== null ? formatINR(projectINR) : "—"} · up to {MAX_DEBT_FUNDING_PCT}% may
            be met by qualifying debt
          </p>
        </div>
      </div>

      <div>
        <Label htmlFor="rate">Sanctioned interest rate (% p.a., optional)</Label>
        <Input
          id="rate"
          inputMode="decimal"
          value={sanctionedRate}
          onChange={(e) => setSanctionedRate(e.target.value)}
        />
      </div>
    </div>
  );
}

const SEVERITY_TONE: Record<Severity, "block" | "draft" | "neutral"> = {
  block: "block",
  warn: "draft",
  info: "neutral",
};

function ChecksPanel({ checks }: { checks: Check[] }) {
  return (
    <section>
      <h2 className="mb-2 text-[11px] uppercase tracking-wide text-stone-500">
        Eligibility gates as the rules engine states them
      </h2>
      <ul className="space-y-2">
        {checks.map((c, i) => (
          <li
            key={`${c.ruleId}-${i}`}
            className="border border-stone-200 bg-white px-3 py-2.5 text-[12px]"
          >
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={SEVERITY_TONE[c.severity]}>{c.severity}</Badge>
              <span className="font-mono text-[11px] text-stone-500">{c.ruleId}</span>
              <span className="font-semibold">{c.title}</span>
            </div>
            <p className="mt-1 leading-relaxed text-stone-700">{c.detail}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
