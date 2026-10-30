/**
 * What the desk review does with messy plant files: dates in other formats, a
 * serial-number column in A, blank rows, two files for one slot. Each case
 * checks that nothing is dropped or replaced without a note, and that evidence
 * coverage is judged on figures, not on how many months have a row.
 */

import { describe, expect, it } from "vitest";
import type { XlsxCell, XlsxSheet } from "../intake/xlsx";
import { checkEvidenceCoverage, checkGcvRule } from "../crosscheck/tieout";
import {
  createReadingWriter,
  dailyColumn,
  dailyColumnReport,
  headerMatches,
  isoDate,
  noteDailyColumn,
  thinMonths,
  type ReadingOrigin,
  type Readings,
} from "./engine";

function sheetFrom(rows: (string | number | null)[][]): XlsxSheet {
  const cells: XlsxCell[] = [];
  rows.forEach((row, r) =>
    row.forEach((value, c) => {
      if (value === null) return;
      cells.push({ ref: `${String.fromCharCode(65 + c)}${r + 1}`, row: r + 1, col: c + 1, value });
    })
  );
  return { name: "Daily", rowCount: rows.length, colCount: rows[0]?.length ?? 0, truncated: false, cells };
}

describe("isoDate", () => {
  it("reads ISO, day-first and named-month dates", () => {
    expect(isoDate("2024-04-01")).toBe("2024-04-01");
    expect(isoDate("01/04/2024")).toBe("2024-04-01");
    expect(isoDate("15-11-2023")).toBe("2023-11-15");
    expect(isoDate("5/6/2025")).toBe("2025-06-05");
    expect(isoDate("01-Nov-2023")).toBe("2023-11-01");
    expect(isoDate("25-DEC-23")).toBe("2023-12-25");
    expect(isoDate("3 Sept 2024")).toBe("2024-09-03");
  });

  it("reads an Excel serial number", () => {
    expect(isoDate(45231)).toBe("2023-11-01");
  });

  it("refuses what is not a real calendar date", () => {
    expect(isoDate("31/02/2024")).toBeNull();
    expect(isoDate("2024-13-01")).toBeNull();
    expect(isoDate("2023-02-30")).toBeNull();
    expect(isoDate("12-Foo-2024")).toBeNull();
    expect(isoDate("RUN")).toBeNull();
    expect(isoDate("Total")).toBeNull();
    expect(isoDate(null)).toBeNull();
    expect(isoDate(100)).toBeNull();
  });
});

describe("headerMatches", () => {
  it("ignores case, spacing and a parenthetical unit that agrees", () => {
    expect(headerMatches("clinker production (t)", "Clinker Production (t)")).toBe(true);
    expect(headerMatches("Clinker Production", "Clinker Production (t)")).toBe(true);
    expect(headerMatches("Clinker Production (MT)", "Clinker Production (t)")).toBe(true);
    expect(headerMatches("Petcoke Consumed", "Petcoke Consumed (t)")).toBe(true);
  });

  it("does not match a different unit, a different column or a bare unit", () => {
    expect(headerMatches("Clinker Production (kg)", "Clinker Production (t)")).toBe(false);
    expect(headerMatches("Clinker Factor", "Clinker Production (t)")).toBe(false);
    expect(headerMatches("Clinker", "Clinker Production (t)")).toBe(false);
    expect(headerMatches("(kWh)", "Gross Generation (kWh)")).toBe(false);
    expect(headerMatches(450, "Clinker Production (t)")).toBe(false);
  });
});

describe("dailyColumnReport", () => {
  it("finds the date column when column A is a serial number", () => {
    const sheet = sheetFrom([
      ["S.No.", "Date", "Clinker Production (MT)"],
      [1, "01/11/2023", 450.5],
      [2, "02/11/2023", 462],
    ]);
    expect(dailyColumn(sheet, "Clinker Production (t)")).toEqual([
      { date: "2023-11-01", value: 450.5 },
      { date: "2023-11-02", value: 462 },
    ]);
  });

  it("takes the left-most column when two columns hold as many dates", () => {
    const sheet = sheetFrom([
      ["Date", "Output (t)", "Report date"],
      ["2024-04-01", 10, "2024-04-02"],
      ["2024-04-02", 11, "2024-04-03"],
    ]);
    expect(dailyColumn(sheet, "Output (t)")?.map((r) => r.date)).toEqual(["2024-04-01", "2024-04-02"]);
  });

  it("reports a row with a figure and an unreadable date instead of dropping it silently", () => {
    const sheet = sheetFrom([
      ["Date", "Output (t)"],
      ["2024-04-01", 10],
      ["April 2nd", 11],
      ["Total", 21],
    ]);
    const report = dailyColumnReport(sheet, "Output (t)")!;
    expect(report.rows).toHaveLength(1);
    expect(report.skipped).toEqual([{ row: 3, raw: "April 2nd" }]);
    const notes: string[] = [];
    noteDailyColumn(report, "Output (t)", (m) => notes.push(m));
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/1 row\(s\).*no date.*April 2nd/);
  });

  it("reports duplicate dates and dated rows with nothing in them", () => {
    const sheet = sheetFrom([
      ["Date", "Output (t)"],
      ["2024-04-01", 10],
      ["2024-04-01", 12],
      ["2024-04-02", null],
    ]);
    const report = dailyColumnReport(sheet, "Output (t)")!;
    expect(report.duplicates).toEqual(["2024-04-01"]);
    expect(report.blank).toBe(1);
    const notes: string[] = [];
    noteDailyColumn(report, "Output (t)", (m) => notes.push(m));
    expect(notes.join(" ")).toMatch(/more than one row/);
    expect(notes.join(" ")).toMatch(/not counted as zero output/);
  });

  it("is null when the header is absent or nothing has a date", () => {
    expect(dailyColumnReport(sheetFrom([["Date", "Output (t)"], ["x", 1]]), "Output (t)")).toBeNull();
    expect(dailyColumnReport(sheetFrom([["Date", "Other"], ["2024-04-01", 1]]), "Output (t)")).toBeNull();
  });
});

describe("createReadingWriter", () => {
  const at = (filename: string, location: string): ReadingOrigin => ({ slot: "production_evidence", documentId: filename, filename, location });

  it("says so when a later file replaces a different figure from an earlier one", () => {
    const readings: Readings = {};
    const origins: Record<string, ReadingOrigin> = {};
    const w = createReadingWriter(readings, origins);
    w.put("scada.clinker@2024-04-01", 400, at("a.xlsx", "Sheet1"));
    w.put("scada.clinker@2024-04-02", 410, at("a.xlsx", "Sheet1"));
    w.put("scada.clinker@2024-04-01", 405, at("b.xlsx", "Sheet1"));
    w.put("scada.clinker@2024-04-02", 410, at("b.xlsx", "Sheet1"));
    expect(readings["scada.clinker@2024-04-01"]).toBe(405);
    expect(origins["scada.clinker@2024-04-01"]!.filename).toBe("b.xlsx");
    const notes = w.notes();
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatch(/b\.xlsx · Sheet1 replaced 1 reading\(s\).*a\.xlsx · Sheet1 \(scada\.clinker\)/);
  });

  it("stays quiet for the same file, or for an identical figure from a second file", () => {
    const readings: Readings = {};
    const w = createReadingWriter(readings, {});
    w.put("x", 1, at("a.xlsx", "S"));
    w.put("x", 2, at("a.xlsx", "S"));
    w.put("y", 5, at("a.xlsx", "S"));
    w.put("y", 5, at("b.xlsx", "S"));
    expect(w.notes()).toEqual([]);
  });
});

describe("thinMonths", () => {
  const month = (m: string, days: number) => Array.from({ length: days }, (_, i) => `${m}-${String(i + 1).padStart(2, "0")}`);

  it("flags a month with far fewer rows than the series' typical month", () => {
    const dates = [...month("2024-04", 30), ...month("2024-05", 31), ...month("2024-06", 4)];
    expect(thinMonths(dates)).toEqual(["2024-06"]);
  });

  it("leaves a monthly series alone", () => {
    expect(thinMonths(["2024-04-30", "2024-05-31", "2024-06-30"])).toEqual([]);
  });

  it("does not count a repeated date twice", () => {
    expect(thinMonths([...month("2024-04", 30), ...month("2024-05", 30), "2024-06-01", "2024-06-01", "2024-06-01"])).toEqual(["2024-06"]);
  });
});

describe("checkEvidenceCoverage on figures, not only months", () => {
  const full = { id: "cov", label: "Clinker", monthsEvidenced: 12, periodMonths: 12, annualCell: 150000, relTolerance: 0.005 };

  it("passes twelve months whose total is the annual cell", () => {
    expect(checkEvidenceCoverage({ ...full, monthlyReading: 150100 }).status).toBe("pass");
  });

  it("fails twelve months whose total is not the annual cell", () => {
    const r = checkEvidenceCoverage({ ...full, monthlyReading: 120000 });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/evidenced total 1,20,000 is not the annual cell 1,50,000/);
  });

  it("fails evidence that runs past the period", () => {
    const r = checkEvidenceCoverage({ ...full, monthsEvidenced: 14, monthlyReading: 150000 });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/14 months, more than the 12-month period/);
  });

  it("fails when a month is thin, even with twelve months present", () => {
    const r = checkEvidenceCoverage({ ...full, monthlyReading: 150000, thinMonths: ["2024-03"] });
    expect(r.status).toBe("fail");
    expect(r.detail).toMatch(/1 month\(s\).*2024-03/);
  });

  it("keeps the old behaviour when no tolerance and no thin months are given", () => {
    expect(checkEvidenceCoverage({ id: "c", label: "x", monthsEvidenced: 12, periodMonths: 12, annualCell: 30, monthlyReading: 2.5 }).status).toBe("pass");
  });
});

describe("checkGcvRule rounding band", () => {
  const base = { internal: 4200, external: 4230, thresholdKcal: 71.7, thresholdSource: "test" };

  it("compares exactly by default and passes a rounded cell inside the band", () => {
    expect(checkGcvRule({ ...base, cell: 4200.3 }).status).toBe("fail");
    expect(checkGcvRule({ ...base, cell: 4200.3, roundingKcal: 0.5 }).status).toBe("pass");
    expect(checkGcvRule({ ...base, cell: 4201, roundingKcal: 0.5 }).status).toBe("fail");
  });
});
