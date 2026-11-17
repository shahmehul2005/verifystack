import { beforeEach, describe, expect, it, vi } from "vitest";
import fc from "fast-check";
import { AuthError } from "@verifystack/backend/lib/auth/getSession";

const requireCapability = vi.fn();
const getEngagement = vi.fn();
const saveCalendarReading = vi.fn();
const extractCalendar = vi.fn();
const logInsert = vi.fn();

vi.mock("@verifystack/backend/lib/auth/requireRole", () => ({
  requireCapability: (...a: unknown[]) => requireCapability(...a),
  assertOrgId: (id: string | null | undefined) => {
    if (!id) throw new AuthError("organization_id is required", 403);
    return id;
  },
}));
vi.mock("@verifystack/backend/lib/data/engagements", () => ({
  getEngagement: (...a: unknown[]) => getEngagement(...a),
}));
vi.mock("@verifystack/backend/lib/data/calendarStore", () => ({
  saveCalendarReading: (...a: unknown[]) => saveCalendarReading(...a),
}));
vi.mock("@verifystack/backend/lib/supabase/admin", () => ({
  createServiceClient: () => ({
    from: () => ({ insert: (...a: unknown[]) => logInsert(...a) }),
  }),
}));
vi.mock("@verifystack/backend/lib/supabase/configured", () => ({
  isExtractorConfigured: () => true,
}));
vi.mock("@verifystack/backend/lib/rateLimit", () => ({
  LIMITS: { modelCallsPerUser: { limit: 1, windowMs: 1000 } },
  rateLimit: () => ({ ok: true, retryAfterSec: 0 }),
}));
vi.mock("@verifystack/backend/lib/extractor/client", () => ({
  extractorClient: { extractCalendar: (...a: unknown[]) => extractCalendar(...a) },
}));

import { POST } from "./route";

const ENG = "11111111-1111-4111-8111-111111111111";
const SESSION_ORG = "org-session";

function request(extra: Record<string, string> = {}) {
  const form = new FormData();
  form.set("file", new File([new Uint8Array([1, 2, 3])], "a.xlsx"));
  form.set("engagementId", ENG);
  for (const [k, v] of Object.entries(extra)) form.set(k, v);
  return new Request("http://localhost/api/calendar/excel", { method: "POST", body: form });
}

const readingArb = fc.record({
  raw_id: fc.string({ minLength: 1, maxLength: 8 }),
  label: fc.option(fc.string({ minLength: 1, maxLength: 12 }), { nil: null }),
  stream_key: fc.constantFrom("electricity", "coal", "clinker"),
  source_type: fc.constantFrom("sourcing", "corroboration", "proforma"),
  period: fc.record({
    month_key: fc.constantFrom("2023-04", "2023-05", "2024-01"),
    date: fc.constant(null),
  }),
  value: fc.double({ min: 0, max: 1e6, noNaN: true }),
  value_as_stated: fc.constant("1"),
  unit_as_stated: fc.option(fc.constant("kWh"), { nil: null }),
  normalized_unit: fc.constant("MWh"),
  normalized_value: fc.option(fc.double({ min: 0, max: 1e6, noNaN: true }), { nil: null }),
  provenance: fc.record({
    page: fc.option(fc.integer({ min: 1, max: 50 }), { nil: null }),
    bbox: fc.constant(null),
    source_text: fc.constant("x"),
    sheet: fc.option(fc.constant("S1"), { nil: null }),
    cell: fc.option(fc.constant("B2"), { nil: null }),
  }),
  confidence: fc.double({ min: 0, max: 1, noNaN: true }),
  verified: fc.boolean(),
  needs_review: fc.boolean(),
  derived: fc.boolean(),
  unit_assumed: fc.boolean(),
  mapping_source: fc.constant("alias"),
  review_reasons: fc.constant([]),
});

const responseArb = fc.array(readingArb, { maxLength: 6 }).map((readings) => ({
  ok: true as const,
  data: {
    readings,
    skipped: [],
    warnings: [],
    unmapped: [],
    run: { model: "m", prompt_version: "p", input_hash: "h", duration_ms: 1 },
  },
}));

const spoofArb = fc.record({
  organizationId: fc.string({ minLength: 1, maxLength: 20 }),
  complianceYear: fc.string({ minLength: 1, maxLength: 10 }),
  reviewedBy: fc.string({ minLength: 1, maxLength: 10 }),
  state: fc.constantFrom("accepted", "rejected", "suggested"),
});

beforeEach(() => {
  vi.clearAllMocks();
  requireCapability.mockResolvedValue({
    user: { id: "user-1" },
    role: "lead_verifier",
    organizationId: SESSION_ORG,
    memberships: [],
  });
  saveCalendarReading.mockResolvedValue({ ok: true, id: "row" });
  logInsert.mockResolvedValue({ error: null });
});

describe("Property 36: Excel route scoping", () => {
  // **Validates: Requirements 15.2, 15.3, 15.4**
  it("every save uses the session org, the engagement year and state suggested", async () => {
    await fc.assert(
      fc.asyncProperty(
        responseArb,
        spoofArb,
        fc.constantFrom("2022-23", "2023-24", "2024-25"),
        async (response, spoof, year) => {
          saveCalendarReading.mockClear();
          getEngagement.mockResolvedValue({ id: ENG, compliance_year: year });
          extractCalendar.mockResolvedValue(response);

          const res = await POST(request(spoof));
          expect(res.status).toBe(200);
          expect(getEngagement).toHaveBeenLastCalledWith(ENG, SESSION_ORG);
          expect(extractCalendar.mock.calls.at(-1)![0].complianceYear).toBe(year);

          const expected = response.data.readings.filter((r) => r.normalized_value !== null);
          expect(saveCalendarReading).toHaveBeenCalledTimes(expected.length);
          for (const call of saveCalendarReading.mock.calls) {
            const p = call[1];
            expect(p.organizationId).toBe(SESSION_ORG);
            expect(p.complianceYear).toBe(year);
            expect(p.state).toBe("suggested");
            expect(p.reviewedBy ?? null).toBeNull();
          }
          const body = await res.json();
          expect(body.savedCount).toBe(expected.length);
        },
      ),
      { numRuns: 50 },
    );
  });

  // **Validates: Requirements 15.2, 15.3, 15.4**
  it("a missing or foreign engagement gives the same 404 and never calls the extractor", async () => {
    let firstBody: unknown;
    await fc.assert(
      fc.asyncProperty(responseArb, spoofArb, async (response, spoof) => {
        extractCalendar.mockClear();
        saveCalendarReading.mockClear();
        getEngagement.mockResolvedValue(null);
        extractCalendar.mockResolvedValue(response);

        const res = await POST(request(spoof));
        expect(res.status).toBe(404);
        const body = await res.json();
        firstBody ??= body;
        expect(body).toEqual(firstBody);
        expect(getEngagement).toHaveBeenLastCalledWith(ENG, SESSION_ORG);
        expect(extractCalendar).not.toHaveBeenCalled();
        expect(saveCalendarReading).not.toHaveBeenCalled();
      }),
      { numRuns: 30 },
    );
  });
});
