import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@verifystack/backend/lib/auth/getSession";

const requireCapability = vi.fn();
const getEngagement = vi.fn();
const saveCalendarReading = vi.fn();
const extractCalendar = vi.fn();
const isExtractorConfigured = vi.fn();
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
vi.mock("@verifystack/backend/lib/supabase/configured", () => ({
  isExtractorConfigured: () => isExtractorConfigured(),
}));
vi.mock("@verifystack/backend/lib/extractor/client", () => ({
  extractorClient: { extractCalendar: (...a: unknown[]) => extractCalendar(...a) },
}));
vi.mock("@verifystack/backend/lib/supabase/admin", () => ({
  createServiceClient: () => ({
    from: (table: string) =>
      table === "ai_action_logs"
        ? { insert: (...a: unknown[]) => logInsert(...a) }
        : {
            select: () => {
              const q: Record<string, unknown> = {};
              q.eq = () => q;
              q.maybeSingle = async () => ({ data: { id: DOC } });
              return q;
            },
          },
  }),
}));

import { POST } from "./route";

const ENG = "11111111-1111-4111-8111-111111111111";
const DOC = "33333333-3333-4333-8333-333333333333";

function reading(over: Record<string, unknown> = {}, prov: Record<string, unknown> = {}) {
  return {
    raw_id: "r1",
    label: "Grid power",
    stream_key: "electricity",
    period: { month_key: "2023-04", date: null },
    source_type: "corroboration",
    value: 1000,
    value_as_stated: "1,000",
    unit_as_stated: "kWh",
    normalized_value: 3.6,
    normalized_unit: "GJ",
    confidence: 0.9,
    verified: true,
    needs_review: false,
    derived: false,
    unit_assumed: false,
    mapping_source: "alias",
    review_reasons: [],
    provenance: { page: null, bbox: null, source_text: "x", sheet: "S1", cell: "B2", ...prov },
    ...over,
  };
}

function ok(readings: unknown[]) {
  return {
    ok: true,
    data: {
      readings,
      skipped: [],
      warnings: [],
      unmapped: [],
      run: { model: "m", prompt_version: "p", input_hash: "h", duration_ms: 5 },
    },
  };
}

function post(body: Record<string, unknown>) {
  return POST(
    new Request("http://localhost/api/calendar/excel", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

function postFile(fields: Record<string, string> = { engagementId: ENG }) {
  const form = new FormData();
  for (const [k, v] of Object.entries(fields)) form.set(k, v);
  form.set("file", new File([new Uint8Array([1, 2, 3])], "a.xlsx"));
  return POST(new Request("http://localhost/api/calendar/excel", { method: "POST", body: form }));
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCapability.mockResolvedValue({ user: { id: "user-1" }, organizationId: "org-1" });
  getEngagement.mockResolvedValue({ id: ENG, compliance_year: "2023-24" });
  isExtractorConfigured.mockReturnValue(true);
  saveCalendarReading.mockResolvedValue({ ok: true });
  extractCalendar.mockResolvedValue(ok([reading()]));
  logInsert.mockResolvedValue({});
});

describe("POST /api/calendar/excel", () => {
  it("does not use fs, child_process or execFile in the source", () => {
    const src = readFileSync(path.join(__dirname, "route.ts"), "utf8");
    expect(src).not.toMatch(/node:fs|from "fs"|child_process|execFile/);
  });

  it("returns 401 without a session", async () => {
    requireCapability.mockRejectedValue(new AuthError("Sign in required", 401));
    const res = await postFile();
    expect(res.status).toBe(401);
    expect(extractCalendar).not.toHaveBeenCalled();
  });

  it("returns 403 without the capability", async () => {
    requireCapability.mockRejectedValue(new AuthError("no", 403));
    expect((await postFile()).status).toBe(403);
  });

  it("returns an identical 404 for a missing or foreign engagement", async () => {
    getEngagement.mockResolvedValue(null);
    const res = await postFile();
    expect(res.status).toBe(404);
    expect(getEngagement).toHaveBeenCalledWith(ENG, "org-1");
    expect(extractCalendar).not.toHaveBeenCalled();
    expect(saveCalendarReading).not.toHaveBeenCalled();
    const res2 = await post({ engagementId: ENG, documentId: DOC });
    expect(await res2.json()).toEqual(await res.json());
  });

  it("returns 503 naming both variables when not configured", async () => {
    isExtractorConfigured.mockReturnValue(false);
    const res = await postFile();
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.error).toContain("EXTRACTOR_URL");
    expect(body.error).toContain("EXTRACTOR_API_KEY");
    expect(extractCalendar).not.toHaveBeenCalled();
  });

  it("saves suggested readings with the service value and ignores spoofed fields", async () => {
    const res = await postFile({
      engagementId: ENG,
      organizationId: "evil-org",
      complianceYear: "1999-00",
    });
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json).toMatchObject({ ok: true, savedCount: 1, extractedCount: 1 });
    expect(extractCalendar.mock.calls[0]![0]).toMatchObject({ complianceYear: "2023-24" });
    const p = saveCalendarReading.mock.calls[0]![1];
    expect(p).toMatchObject({
      state: "suggested",
      organizationId: "org-1",
      complianceYear: "2023-24",
      standardValue: 3.6,
      valueNumeric: 1000,
    });
  });

  it("uses a null page, null bbox and workbook_reader for Excel readings", async () => {
    await postFile();
    const p = saveCalendarReading.mock.calls[0]![1];
    expect(p.provenancePage).toBeNull();
    expect(p.provenanceBbox).toBeNull();
    expect(p.extractionMethod).toBe("workbook_reader");
    expect(p.readingMeta.locator).toEqual({ sheet: "S1", cellRef: "B2" });
  });

  it("skips readings without a normalized value", async () => {
    extractCalendar.mockResolvedValue(ok([reading({ normalized_value: null })]));
    const json = await (await postFile()).json();
    expect(saveCalendarReading).not.toHaveBeenCalled();
    expect(json.savedCount).toBe(0);
    expect(json.skipped[0]).toMatchObject({ reason: "no_normalized_value" });
  });

  it.each([
    ["too_large", 413],
    ["unsupported", 415],
    ["unprocessable", 422],
    ["timeout", 504],
    ["model_unavailable", 503],
    ["not_configured", 503],
    ["auth", 502],
    ["service", 502],
    ["invalid_response", 502],
  ])("maps client error %s to %i and logs it", async (kind, status) => {
    extractCalendar.mockResolvedValue({ ok: false, error: { kind } });
    const res = await postFile();
    expect(res.status).toBe(status);
    expect(saveCalendarReading).not.toHaveBeenCalled();
    expect(logInsert.mock.calls[0]![0]).toMatchObject({ ok: false, error: kind });
  });
});
