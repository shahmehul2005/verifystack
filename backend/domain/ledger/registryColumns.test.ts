import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = (rel: string) => fileURLToPath(new URL(rel, import.meta.url));
const read = (rel: string) => readFileSync(here(rel), "utf8").replace(/\r\n/g, "\n");
const SQL25 = read("../../supabase/migrations/0025_registry_key_and_period.sql");
const SQL24 = read("../../supabase/migrations/0024_withdraw_fact_fn.sql");

const COLUMNS = ["canonical_key", "period_start", "period_end", "period_status", "period_note", "registry_version"];
const TABLES = ["extracted_fields", "facts", "fact_withdrawals"];

describe("migration 0025: columns", () => {
  it("adds every column to every table, nullable, without touching a row", () => {
    for (const t of TABLES) {
      const block = SQL25.slice(SQL25.indexOf(`alter table public.${t}\n`), SQL25.indexOf(";", SQL25.indexOf(`alter table public.${t}\n`)));
      for (const c of COLUMNS) expect(block, `${t}.${c}`).toContain(`add column if not exists ${c} `);
      expect(block, t).not.toMatch(/not null|default/i);
    }
    // Additive only: the columns and constraints (everything before the function) update, delete and
    // rewrite no row, and never lift the append-only guard, so the ledger stays as it was.
    const columnsPart = SQL25.slice(0, SQL25.indexOf("create or replace function"));
    expect(columnsPart.length).toBeGreaterThan(1000);
    expect(columnsPart).not.toMatch(/^\s*(update|delete from|truncate)\s/im);
    expect(columnsPart).not.toMatch(/allow_purge/);
    // The purge is lifted only inside the withdrawal function, as in 0024.
    expect(SQL25.match(/allow_purge/g)).toHaveLength(2);
  });

  it("allows a period that is known, unknown or not assessed, and nothing in between", () => {
    expect(SQL25).toMatch(/period_status is null and period_start is null and period_end is null/);
    expect(SQL25).toMatch(/period_status = ''unknown'' and period_start is null and period_end is null/);
    expect(SQL25).toMatch(/period_status = ''known'' and period_start is not null and period_end is not null and period_start <= period_end/);
    for (const t of TABLES) expect(SQL25).toContain(`'${t}'`);
  });

  it("requires a registry version wherever there is a key", () => {
    expect(SQL25).toMatch(/canonical_key is null or registry_version is not null/);
  });
});

describe("migration 0025: withdrawal keeps the new columns", () => {
  const body = (sql: string) => sql.slice(sql.indexOf("create or replace function public.withdraw_fact"), sql.indexOf("-- Supabase grants execute"));

  it("copies every new column from the fact into the withdrawal", () => {
    const fn = body(SQL25);
    for (const c of COLUMNS) {
      expect(fn, c).toContain(`f.${c}`);
      expect(fn, c).toMatch(new RegExp(`\\b${c}\\b[^;]*\\) values`, "s"));
    }
  });

  it("is the 0024 function plus those columns and nothing else", () => {
    const stripped = body(SQL25)
      .replace(",\n    canonical_key, period_start, period_end, period_status, period_note, registry_version\n  ) values (", "\n  ) values (")
      .replace(",\n    f.canonical_key, f.period_start, f.period_end, f.period_status, f.period_note, f.registry_version\n  ) returning", "\n  ) returning");
    expect(stripped.trim()).toBe(body(SQL24).trim());
  });

  it("keeps the service-role-only grants", () => {
    expect(SQL25).toMatch(/revoke all on function public\.withdraw_fact\(uuid, uuid, uuid, text, uuid\) from public, anon, authenticated;/);
    const grants = SQL25.match(/grant execute[^;]*;/g) ?? [];
    expect(grants).toHaveLength(1);
    expect(grants[0]).toMatch(/ to service_role;$/);
  });
});

describe("the columns are written from the extraction and carried onto facts, never worked out elsewhere", () => {
  it("the individual and bulk accept routes carry the extracted field's columns", () => {
    expect(read("../../../frontend/app/api/facts/route.ts")).toMatch(/\.\.\.carriedRegistryColumns\(field\)/);
    expect(read("../../../frontend/app/api/facts/bulk/route.ts")).toMatch(/\.\.\.carriedRegistryColumns\(f\)/);
  });

  it("extraction annotates in code and falls back when the database has no such column", () => {
    const src = read("../extraction/runDocument.ts");
    expect(src).toMatch(/annotateDocument\(/);
    expect(src).toMatch(/isMissingRegistryColumn\(insErr\)/);
    expect(src).toMatch(/registryForPack\(input\.packId\)/);
  });
});

describe("nothing here feeds a calculation", () => {
  const walk = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? walk(p) : p.endsWith(".ts") && !p.endsWith(".test.ts") ? [p] : [];
    });

  it("no calculation code reads the key, period or registry version", () => {
    const files = [...walk(here("../calc")), here("../../../frontend/app/api/runs/route.ts")];
    expect(files.length).toBeGreaterThan(3);
    for (const f of files) {
      const text = readFileSync(f, "utf8");
      expect(text, f).not.toMatch(/canonical_key|period_status|period_start|period_end|registry_version/);
    }
  });
});
