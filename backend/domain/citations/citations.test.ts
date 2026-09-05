import { describe, expect, it } from "vitest";
import { buildFactorSet } from "../factors";
import { qty } from "../units";
import { calculate, type CalcInput } from "../calc/engine";
import { assessSavings, calculateSec, type SecInput } from "../calc/sec";
import { runRules } from "../rules/rules";
import {
  runAdeetieRules,
  type AdeetieContext,
  type AdeetieEligibilityInput,
} from "../rules/adeetie";
import type { ReconciliationContext, RuleFinding } from "../rules/types";
import { citeFinding } from "./attach";
import { chunkByClauseBoundary } from "./chunk";
import { SYNTHETIC_CORPUS, RETRIEVAL_GOLDEN } from "./corpus";
import { mockEmbedding } from "./mockEmbed";
import { filterThenRank, type RankableChunk } from "./rank";
import { NO_APPLICABLE_CLAUSE, type CiteDeps, type RetrievedChunk } from "./types";

const factors = buildFactorSet("citation-test-0.1.0");

const FY_MONTHS = [
  "2024-04", "2024-05", "2024-06", "2024-07", "2024-08", "2024-09",
  "2024-10", "2024-11", "2024-12", "2025-01", "2025-02", "2025-03",
];

function eligible(overrides: Partial<AdeetieEligibilityInput> = {}): AdeetieEligibilityInput {
  return {
    enterpriseName: "Demo Castings Pvt Ltd",
    category: "Small",
    udyamRegistrationNo: "UDYAM-PB-05-1234567",
    sector: "Foundry",
    cluster: "Batala, Jalandhar & Ludhiana",
    loanAmountINR: 2_00_00_000,
    projectCostINR: 3_00_00_000,
    sanctionedRatePct: 10,
    factIds: ["f-udyam"],
    ...overrides,
  };
}

function adeetieCtx(overrides: Partial<AdeetieContext> = {}): AdeetieContext {
  return {
    baselinePeriodLabel: "FY2024-25",
    expectedMonths: FY_MONTHS,
    energyBalance: FY_MONTHS.map((month) => ({
      month,
      billedEnergyMJ: 100_000,
      meteredEnergyMJ: 100_000,
      factIds: [`f-${month}`],
    })),
    meterCalibrations: [],
    eligibility: eligible(),
    ...overrides,
  };
}

function secResult(sec: number, phase: SecInput["phase"]) {
  const output = 1_000;
  return calculateSec(
    {
      engagementId: "eng-foundry",
      periodLabel: "FY2024-25",
      phase,
      reportingEnergyUnit: "GJ",
      secUnitLabel: "GJ/t",
      allowUnverifiedFactors: true,
      streams: [
        {
          kind: "thermal_direct",
          streamId: "total",
          label: "Total energy input",
          quantity: qty(sec * output, "GJ"),
          methodologyRef: "Test fixture",
          provenance: { factIds: ["f-total"] },
        },
      ],
      production: {
        quantity: qty(output, "t"),
        productUnitLabel: "tonne_good_castings",
        provenance: { factIds: ["f-prod"] },
      },
    },
    factors
  );
}

const calcInput: CalcInput = {
  engagementId: "eng-001",
  complianceYear: "FY2025-26",
  sector: "cement",
  allowUnverifiedFactors: true,
  streams: [
    {
      kind: "fuel_combustion",
      streamId: "coal-1",
      label: "Coal",
      emissionFactorId: "ef_coal_subbituminous",
      emissionFactorVintage: "IPCC2006",
      quantity: qty(1000, "t"),
      calorificValue: qty(20, "MJ/kg"),
      calorificBasis: "NCV",
      phase: "solid",
      provenance: { factIds: ["f1"] },
    },
  ],
  production: {
    quantity: qty(10_000, "t"),
    productUnitLabel: "tonne_cement",
    provenance: { factIds: ["f-prod"] },
  },
};

function cctsCtx(overrides: Partial<ReconciliationContext> = {}): ReconciliationContext {
  return {
    complianceYear: "FY2025-26",
    expectedMonths: [
      "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09",
      "2025-10", "2025-11", "2025-12", "2026-01", "2026-02", "2026-03",
    ],
    calc: calculate(calcInput, factors),
    monthlySeries: {},
    stockMovements: [],
    labCertificates: [],
    samplingRecords: [],
    ...overrides,
  };
}

function findingFor(ruleId: string): RuleFinding {
  const adeetie: Record<string, () => RuleFinding[]> = {
    "AD-ELG001": () =>
      runAdeetieRules(adeetieCtx({ eligibility: eligible({ udyamRegistrationNo: undefined }) })).findings,
    "AD-ELG002": () =>
      runAdeetieRules(adeetieCtx({ eligibility: eligible({ cluster: "Somewhere Else" }) })).findings,
    "AD-ELG003": () =>
      runAdeetieRules(adeetieCtx({ eligibility: eligible({ loanAmountINR: 1_00_000 }) })).findings,
    "AD-ELG004": () =>
      runAdeetieRules(
        adeetieCtx({
          eligibility: eligible({ loanAmountINR: 8_00_00_000, projectCostINR: 10_00_00_000 }),
        })
      ).findings,
    "AD-ELG005": () =>
      runAdeetieRules(
        adeetieCtx({ eligibility: eligible({ category: "Medium", claimedSubventionPct: 5 }) })
      ).findings,
    "AD-SAV001": () => {
      const baseline = secResult(20, "baseline");
      const post = secResult(18.1, "post_implementation");
      return runAdeetieRules(
        adeetieCtx({ baselineSec: baseline, postSec: post, savings: assessSavings(baseline, post) })
      ).findings;
    },
    "AD-EB001": () => {
      const c = adeetieCtx();
      c.energyBalance = c.energyBalance.map((m) => ({ ...m, meteredEnergyMJ: 80_000 }));
      return runAdeetieRules(c).findings;
    },
    "AD-CAL001": () =>
      runAdeetieRules(
        adeetieCtx({
          meterCalibrations: [
            {
              meterId: "EM-02",
              description: "Furnace sub-meter",
              reliedOnFrom: "2024-04-01",
              reliedOnTo: "2025-03-31",
              factIds: ["f-cal2"],
            },
          ],
        })
      ).findings,
    "AD-TS001": () => {
      const c = adeetieCtx();
      c.energyBalance = c.energyBalance.slice(0, 10);
      return runAdeetieRules(c).findings;
    },
  };
  const ccts: Record<string, () => RuleFinding[]> = {
    MB001: () =>
      runRules(
        cctsCtx({
          stockMovements: [
            {
              streamId: "coal-1",
              openingStock: qty(500, "t"),
              purchases: qty(1000, "t"),
              closingStock: qty(500, "t"),
              reportedConsumption: qty(900, "t"),
              factIds: ["f-stock"],
            },
          ],
        })
      ).findings,
    CV001: () =>
      runRules(
        cctsCtx({
          labCertificates: [
            {
              certificateId: "LAB-GCV",
              labName: "Test Lab",
              nablAccreditationNo: "TC-1",
              nablValidUntil: "2027-01-01",
              testDate: "2025-06-01",
              fuelKey: "coal_indian",
              calorificValue: qty(4200, "kcal/kg"),
              calorificBasis: "GCV",
              factIds: ["f-lab"],
            },
          ],
        })
      ).findings,
    LB001: () =>
      runRules(
        cctsCtx({
          labCertificates: [
            {
              certificateId: "LAB-003",
              labName: "Test Lab",
              nablAccreditationNo: "TC-9999",
              nablValidUntil: "2025-05-31",
              testDate: "2025-08-15",
              fuelKey: "coal_indian",
              calorificValue: qty(4200, "kcal/kg"),
              calorificBasis: "NCV",
              factIds: ["f-lab"],
            },
          ],
        })
      ).findings,
    TS001: () =>
      runRules(
        cctsCtx({
          monthlySeries: {
            "coal-1": [
              "2025-04", "2025-05", "2025-06", "2025-07", "2025-08", "2025-09",
              "2025-10", "2025-11", "2025-12", "2026-01",
            ].map((month) => ({
              month,
              quantity: qty(100, "t"),
              factIds: [`f-${month}`],
            })),
          },
        })
      ).findings,
    SM001: () =>
      runRules(
        cctsCtx({
          samplingRecords: [
            {
              materialKind: "coal",
              month: "2025-06",
              samplesTaken: 1,
              throughput: qty(65_000, "t"),
              factIds: ["f-sample"],
            },
          ],
        })
      ).findings,
    EF001: () => runRules(cctsCtx({ gridFactorVintageUsed: "FY2023-24" })).findings,
  };

  const pool = { ...adeetie, ...ccts }[ruleId]?.() ?? [];
  const hit = pool.find((f) => f.ruleId === ruleId);
  if (!hit) throw new Error(`No finding for ${ruleId}`);
  return hit;
}

function corpusChunks(): RankableChunk[] {
  return SYNTHETIC_CORPUS.flatMap((doc) =>
    chunkByClauseBoundary(doc.body).map((c, i) => ({
      id: `${doc.scheme}-${c.clauseRef}-${i}`,
      clauseRef: c.clauseRef,
      pageNumber: c.pageNumber,
      chunkText: c.chunkText,
      documentTitle: doc.title,
      sourceUrl: doc.sourceUrl,
      scheme: doc.scheme,
      sectorOrCluster: doc.sectorOrCluster,
      embedding: mockEmbedding(`${c.clauseRef ?? ""} ${c.chunkText}`),
    }))
  );
}

function inMemoryDeps(opts?: {
  draft?: CiteDeps["draft"];
}): CiteDeps {
  const chunks = corpusChunks();
  return {
    embed: async (text) => mockEmbedding(text),
    retrieve: async (queryEmbedding, filter) => filterThenRank(chunks, queryEmbedding, filter),
    draft:
      opts?.draft ??
      (async (_title, _detail, retrieved) => {
        const top = retrieved[0];
        if (!top) {
          return { applicable: false, noApplicableClause: NO_APPLICABLE_CLAUSE, citations: [] };
        }
        return {
          applicable: true,
          citations: [
            {
              clauseRef: top.clauseRef ?? "unknown",
              documentTitle: top.documentTitle,
              pageNumber: top.pageNumber,
              quotedText: top.chunkText.slice(0, 120),
              explanation: `The retrieved clause ${top.clauseRef} addresses this finding.`,
            },
          ],
        };
      }),
  };
}

describe("retrieval recall (synthetic corpus, mock embeddings)", () => {
  const chunks = corpusChunks();

  it("ranks the labelled clause in the top-k for each ingested sector", () => {
    for (const gold of RETRIEVAL_GOLDEN) {
      const finding = findingFor(gold.ruleId);
      const query = mockEmbedding(
        [finding.ruleId, finding.title, finding.detail, finding.clauseRef].join("\n")
      );
      const ranked = filterThenRank(chunks, query, {
        scheme: gold.scheme,
        sectorOrCluster: gold.sectorOrCluster,
      });
      const refs = ranked.map((c) => c.clauseRef);
      expect(refs, `${gold.ruleId} expected ${gold.expectedClauseRef}, got ${refs.join(",")}`).toContain(
        gold.expectedClauseRef
      );
    }
  });
});

describe("adversarial: no matching chunk", () => {
  it("returns no applicable clause found rather than forcing a citation", async () => {
    const finding: RuleFinding = {
      ruleId: "AD-FAKE-ISO",
      severity: "block",
      title: "ISO 50001 certification missing",
      detail:
        "The application file does not include ISO 50001 energy management system certification for the melting shop.",
      clauseRef: "ISO 50001 — not in this corpus",
      evidenceRefs: [],
    };
    const attached = await citeFinding(
      finding,
      { scheme: "ADEETIE", sectorOrCluster: "Foundry" },
      inMemoryDeps({
        draft: async () => ({
          applicable: false,
          noApplicableClause: NO_APPLICABLE_CLAUSE,
          citations: [],
        }),
      })
    );
    expect(attached.kind).toBe("no_applicable_clause");
    expect(attached.columns.citation_clause_ref).toBeNull();
    expect(attached.columns.citation_chunk_text).toBeNull();
    expect(attached.columns.citation_explanation).toBe(NO_APPLICABLE_CLAUSE);
  });

  it("does not attach a citation when retrieval itself finds nothing above the floor", async () => {
    const finding: RuleFinding = {
      ruleId: "AD-FAKE-ISO",
      severity: "block",
      title: "ISO 50001 certification missing",
      detail:
        "xyzzy plugh ISO50001cert melting-shop-only-token-not-in-corpus qwertyuiop",
      clauseRef: "not-a-real-clause",
      evidenceRefs: [],
    };
    const attached = await citeFinding(
      finding,
      { scheme: "ADEETIE", sectorOrCluster: "Foundry" },
      inMemoryDeps()
    );
    expect(attached.columns.citation_clause_ref).toBeNull();
    expect(attached.columns.citation_chunk_text).toBeNull();
    expect(["no_applicable_clause", "rejected"]).toContain(attached.kind);
  });
});

describe("groundedness of generated output", () => {
  it("attaches a suggested citation only when every quote text-matches a retrieved chunk", async () => {
    const finding = findingFor("AD-ELG001");
    const attached = await citeFinding(
      finding,
      { scheme: "ADEETIE", sectorOrCluster: "Foundry" },
      inMemoryDeps()
    );
    expect(attached.kind).toBe("grounded");
    if (attached.kind !== "grounded") return;
    expect(attached.state).toBe("suggested");
    expect(attached.columns.citation_chunk_text).toBeTruthy();
    const retrieved: RetrievedChunk[] = [attached.chunk];
    expect(
      retrieved.some((c) =>
        attached.columns.citation_chunk_text
          ? c.chunkText.includes(attached.columns.citation_chunk_text) ||
            attached.columns.citation_chunk_text.includes(c.chunkText.slice(0, 40))
          : false
      )
    ).toBe(true);
  });

  it("rejects output that cites a clause outside the retrieved set", async () => {
    const finding = findingFor("AD-ELG001");
    const attached = await citeFinding(
      finding,
      { scheme: "ADEETIE", sectorOrCluster: "Foundry" },
      inMemoryDeps({
        draft: async () => ({
          applicable: true,
          citations: [
            {
              clauseRef: "Para 99.9",
              documentTitle: "A document that was not retrieved",
              pageNumber: 1,
              quotedText: "Enterprises shall hold ISO 50001 certification",
              explanation: "Forced citation.",
            },
          ],
        }),
      })
    );
    expect(attached.kind).toBe("rejected");
    expect(attached.columns.citation_clause_ref).toBeNull();
    expect(attached.columns.citation_chunk_text).toBeNull();
  });
});
