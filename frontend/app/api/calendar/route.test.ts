import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@verifystack/backend/lib/auth/getSession";

const requireCapability = vi.fn();
const getEngagement = vi.fn();
const saveCalendarReading = vi.fn();

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
  loadCalendarGridForEngagement: vi.fn(),
}));
vi.mock("@verifystack/backend/lib/supabase/admin", () => ({
  createServiceClient: () => ({ fake: "db" }),
}));
vi.mock("@verifystack/backend/lib/supabase/server", () => ({
  createServerSupabase: async () => null,
}));

import { POST } from "./route";

const ENG_A = "11111111-1111-4111-8111-111111111111";
const ENG_B = "22222222-2222-4222-8222-222222222222";

function item(engagementId = ENG_A, monthKey = "2023-04") {
  return {
    engagementId,
    streamKey: "electricity",
    monthKey,
    sourceType: "sourcing",
    valueNumeric: 100,
  };
}

function post(body: unknown) {
  return POST(
    new Request("http://localhost/api/calendar", {
      method: "POST",
      body: JSON.stringify(body),
    })
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NODE_ENV", "development");
  vi.stubEnv("VERCEL", "");
  requireCapability.mockResolvedValue({
    user: { id: "user-1" },
    role: "lead_verifier",
    organizationId: "org-1",
    memberships: [],
  });
  getEngagement.mockResolvedValue({ id: ENG_A });
  saveCalendarReading.mockResolvedValue({ ok: true, id: "row-1" });
});

describe("POST /api/calendar", () => {
  it("returns 401 without a session, even in development", async () => {
    requireCapability.mockRejectedValue(new AuthError("Sign in required", 401));
    const res = await post(item());
    expect(res.status).toBe(401);
    expect(saveCalendarReading).not.toHaveBeenCalled();
  });

  it("returns 403 without the capability", async () => {
    requireCapability.mockRejectedValue(new AuthError("Your role cannot perform this action.", 403));
    const res = await post(item());
    expect(res.status).toBe(403);
    expect(saveCalendarReading).not.toHaveBeenCalled();
  });

  it("returns 404 for another organization's engagement before any save", async () => {
    getEngagement.mockImplementation(async (id: string) => (id === ENG_A ? { id } : null));
    const res = await post({ items: [item(ENG_A), item(ENG_B, "2023-05")] });
    expect(res.status).toBe(404);
    expect(getEngagement).toHaveBeenCalledWith(ENG_B, "org-1");
    expect(saveCalendarReading).not.toHaveBeenCalled();
  });

  it("saves as accepted with the session's organization and reviewer", async () => {
    const res = await post(item());
    expect(res.status).toBe(200);
    expect(getEngagement).toHaveBeenCalledWith(ENG_A, "org-1");
    expect(saveCalendarReading).toHaveBeenCalledTimes(1);
    const params = saveCalendarReading.mock.calls[0]![1];
    expect(params).toMatchObject({
      state: "accepted",
      reviewedBy: "user-1",
      organizationId: "org-1",
    });
  });

  it("does not contain the dev-verifier fallback in the source", () => {
    const src = readFileSync(path.join(__dirname, "route.ts"), "utf8");
    expect(src).not.toContain("dev-verifier");
  });
});
