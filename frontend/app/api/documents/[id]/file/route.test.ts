import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@verifystack/backend/lib/auth/getSession";
import { XLSX_MIME } from "@verifystack/backend/lib/evidence";

const requireCapability = vi.fn();
let docRow: Record<string, unknown> | null = null;

vi.mock("@verifystack/backend/lib/auth/requireRole", () => ({
  requireCapability: (...a: unknown[]) => requireCapability(...a),
  assertOrgId: (id: string | null | undefined) => {
    if (!id) throw new AuthError("organization_id is required", 403);
    return id;
  },
}));
vi.mock("@verifystack/backend/lib/supabase/admin", () => ({
  createServiceClient: () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        single: async () => ({ data: docRow }),
      };
      return q;
    },
    storage: { from: () => ({ download: async () => ({ data: new Blob(["bytes"]), error: null }) }) },
  }),
}));
vi.mock("@verifystack/backend/lib/supabase/server", () => ({
  createServerSupabase: async () => null,
}));

import { GET } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";

function get(query = "") {
  return GET(new Request(`http://localhost/api/documents/${ID}/file${query}`), {
    params: Promise.resolve({ id: ID }),
  });
}

function setDoc(mime: string, name: string) {
  docRow = { id: ID, organization_id: "org-1", storage_path: "p", mime_type: mime, original_filename: name };
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCapability.mockResolvedValue({ user: { id: "u" }, role: "auditor", organizationId: "org-1", memberships: [] });
});

describe("GET /api/documents/[id]/file", () => {
  it("serves a PDF inline when there is no download parameter", async () => {
    setDoc("application/pdf", "cert.pdf");
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toMatch(/^inline/);
  });

  it("serves a PDF as an attachment with ?download=1, keeping its Content-Type", async () => {
    setDoc("application/pdf", "cert.pdf");
    const res = await get("?download=1");
    expect(res.headers.get("Content-Type")).toBe("application/pdf");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment/);
  });

  it("serves an XLSX as octet-stream attachment without the parameter", async () => {
    setDoc(XLSX_MIME, "proforma.xlsx");
    const res = await get();
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment/);
    expect(res.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });

  it("serves an XLSX as attachment with ?download=1", async () => {
    setDoc(XLSX_MIME, "proforma.xlsx");
    const res = await get("?download=1");
    expect(res.headers.get("Content-Type")).toBe("application/octet-stream");
    expect(res.headers.get("Content-Disposition")).toMatch(/^attachment/);
  });

  it("treats download values other than 1 as no parameter", async () => {
    setDoc("application/pdf", "cert.pdf");
    expect((await get("?download=0")).headers.get("Content-Disposition")).toMatch(/^inline/);
  });

  it("returns 404 when the document is not found for the organization", async () => {
    docRow = null;
    expect((await get()).status).toBe(404);
  });

  it("returns 401 without a session", async () => {
    requireCapability.mockRejectedValue(new AuthError("Sign in required", 401));
    expect((await get()).status).toBe(401);
  });
});
