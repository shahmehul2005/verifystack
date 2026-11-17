import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthError } from "@verifystack/backend/lib/auth/getSession";
import { CSV_MIME, XLSX_MIME } from "@verifystack/backend/lib/evidence";

const requireCapability = vi.fn();
const download = vi.fn();
let docRow: Record<string, unknown> | null = null;

vi.mock("@verifystack/backend/lib/auth/requireRole", () => ({
  requireCapability: (...a: unknown[]) => requireCapability(...a),
  assertOrgId: (id: string | null | undefined) => {
    if (!id) throw new AuthError("organization_id is required", 403);
    return id;
  },
}));

// The fake applies the organization filter the way the database would.
vi.mock("@verifystack/backend/lib/supabase/admin", () => ({
  createServiceClient: () => ({
    from: () => {
      const filters: Record<string, unknown> = {};
      const q = {
        select: () => q,
        eq: (col: string, val: unknown) => {
          filters[col] = val;
          return q;
        },
        maybeSingle: async () => ({
          data: docRow && Object.entries(filters).every(([k, v]) => docRow![k] === v) ? docRow : null,
        }),
      };
      return q;
    },
    storage: { from: () => ({ download: (...a: unknown[]) => download(...a) }) },
  }),
}));
vi.mock("@verifystack/backend/lib/supabase/server", () => ({
  createServerSupabase: async () => null,
}));

import { GET } from "./route";

const DOC_ID = "11111111-1111-4111-8111-111111111111";

function blob(text: string | Uint8Array) {
  return new Blob([text as BlobPart]);
}

function get(query = "") {
  return GET(new Request(`http://localhost/api/documents/${DOC_ID}/sheet${query}`), {
    params: Promise.resolve({ id: DOC_ID }),
  });
}

function csv(rows: number) {
  return ["a,b", ...Array.from({ length: rows }, (_, i) => `${i + 1},x${i + 1}`)].join("\n");
}

beforeEach(() => {
  vi.clearAllMocks();
  requireCapability.mockResolvedValue({ user: { id: "u" }, role: "auditor", organizationId: "org-1", memberships: [] });
  docRow = {
    id: DOC_ID,
    organization_id: "org-1",
    storage_path: "org-1/doc.csv",
    mime_type: CSV_MIME,
    original_filename: "data.csv",
  };
  download.mockResolvedValue({ data: blob(csv(5)), error: null });
});

describe("GET /api/documents/[id]/sheet", () => {
  it("returns 401 without a session", async () => {
    requireCapability.mockRejectedValue(new AuthError("Sign in required", 401));
    expect((await get()).status).toBe(401);
    expect(download).not.toHaveBeenCalled();
  });

  it("returns 403 without the capability", async () => {
    requireCapability.mockRejectedValue(new AuthError("Your role cannot perform this action.", 403));
    expect((await get()).status).toBe(403);
    expect(requireCapability).toHaveBeenCalledWith("documents.view");
  });

  it("returns 404 for a document in another organization", async () => {
    docRow = { ...docRow!, organization_id: "org-2" };
    const res = await get();
    expect(res.status).toBe(404);
    expect(download).not.toHaveBeenCalled();
  });

  it("returns 415 for a PDF", async () => {
    docRow = { ...docRow!, mime_type: "application/pdf" };
    const res = await get();
    expect(res.status).toBe(415);
    expect(download).not.toHaveBeenCalled();
  });

  it("returns 422 for a corrupt workbook", async () => {
    docRow = { ...docRow!, mime_type: XLSX_MIME, original_filename: "bad.xlsx" };
    download.mockResolvedValue({ data: blob(new Uint8Array([1, 2, 3, 4, 5])), error: null });
    const res = await get();
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.ok).toBe(false);
    expect(typeof body.error).toBe("string");
  });

  it("returns 404 file_missing when the stored object is gone", async () => {
    download.mockResolvedValue({ data: null, error: null });
    const res = await get();
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("file_missing");
  });

  it("returns a default window with cache header and no truncation for a small sheet", async () => {
    const res = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, max-age=60");
    const body = await res.json();
    expect(body.ok).toBe(true);
    expect(body.document).toEqual({ id: DOC_ID, name: "data.csv", mimeType: CSV_MIME });
    expect(body.view.active.rows).toHaveLength(6);
    expect(body.truncated).toBe(false);
  });

  it("defaults to 200 rows and flags truncation", async () => {
    download.mockResolvedValue({ data: blob(csv(300)), error: null });
    const body = await (await get()).json();
    expect(body.view.active.rows).toHaveLength(200);
    expect(body.view.active.hasMoreRows).toBe(true);
    expect(body.truncated).toBe(true);
  });

  it("honours rowStart and rowLimit, and caps rowLimit at 500", async () => {
    download.mockResolvedValue({ data: blob(csv(700)), error: null });
    const small = await (await get("?rowStart=11&rowLimit=5")).json();
    expect(small.view.active.rowStart).toBe(11);
    expect(small.view.active.rows.map((r: { n: number }) => r.n)).toEqual([11, 12, 13, 14, 15]);
    const big = await (await get("?rowLimit=10000")).json();
    expect(big.view.active.rows).toHaveLength(500);
  });

  it("returns 400 for a malformed window parameter", async () => {
    expect((await get("?rowStart=abc")).status).toBe(400);
    expect((await get("?rowLimit=0")).status).toBe(400);
  });
});
