import { describe, expect, it } from "vitest";
import { AuthError } from "./getSession";
import { assertOrgId } from "./requireRole";
import { assertAuditPayload } from "./auditEvent";

describe("RLS-sensitive helpers", () => {
  it("refuses audit events without organization_id", () => {
    expect(() =>
      assertAuditPayload({
        organizationId: "",
        action: "document.uploaded",
        entityType: "document",
      })
    ).toThrow(AuthError);
  });

  it("requires action and entity type", () => {
    expect(() =>
      assertAuditPayload({
        organizationId: "org-1",
        action: "",
        entityType: "document",
      })
    ).toThrow(AuthError);
  });

  it("accepts a scoped payload", () => {
    const p = assertAuditPayload({
      organizationId: "org-1",
      action: "fact.accepted",
      entityType: "fact",
      entityId: "fact-1",
    });
    expect(p.organizationId).toBe("org-1");
  });

  it("assertOrgId rejects missing tenant", () => {
    expect(() => assertOrgId(null)).toThrow(AuthError);
    expect(() => assertOrgId(undefined)).toThrow(AuthError);
    expect(assertOrgId("org-1")).toBe("org-1");
  });
});
