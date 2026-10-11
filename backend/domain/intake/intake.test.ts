import { describe, expect, it } from "vitest";
import { writeZip } from "../archive/zip";
import { csvField, CsvError, detectDelimiter, parseCsv, toCsv } from "./csv";
import { cellAt, columnLetters, parseCellRef, parseXlsx, sheetRows, XlsxError } from "./xlsx";
import { aggregateRange, normaliseTimeSeries, parseTimestamp, TimeSeriesError } from "./timeseries";

describe("parseCsv", () => {
  it("handles quotes, embedded delimiters, newlines and a BOM", () => {
    const { rows } = parseCsv('\uFEFFa,b\r\n"x, y","he said ""hi"""\r\n"line1\nline2",3\r\n');
    expect(rows).toEqual([
      ["a", "b"],
      ["x, y", 'he said "hi"'],
      ["line1\nline2", "3"],
    ]);
  });

  it("detects semicolon and tab exports", () => {
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\n1\t2")).toBe("\t");
    expect(detectDelimiter("a,b\n1,2")).toBe(",");
  });

  it("enforces limits and rejects unterminated quotes", () => {
    expect(() => parseCsv("a,b\n1,2\n3,4", { limits: { maxRows: 1, maxColumns: 9 } })).toThrow(CsvError);
    expect(() => parseCsv('a\n"open')).toThrow(/Unterminated/);
  });

  it("neutralises spreadsheet formulas on output", () => {
    expect(csvField("=HYPERLINK(x)")).toBe("'=HYPERLINK(x)");
    expect(csvField("-12.5")).toBe("-12.5");
    expect(toCsv(["a"], [["x,y"]])).toBe('a\r\n"x,y"\r\n');
  });
});

function xlsxFixture(): Uint8Array {
  const ct = '<?xml version="1.0"?><Types xmlns="x"/>';
  const wb =
    '<workbook xmlns:r="r"><sheets><sheet name="Inputs &amp; Bills" sheetId="1" r:id="rId1"/><sheet name="Output" sheetId="2" r:id="rId2"/></sheets></workbook>';
  const rels =
    '<Relationships><Relationship Id="rId1" Type="t" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="t" Target="/xl/worksheets/sheet2.xml"/></Relationships>';
  const ss = '<sst><si><t>Fuel</t></si><si><r><t>Coal </t></r><r><t>A&amp;B</t></r></si></sst>';
  const sheet1 =
    '<worksheet><sheetData>' +
    '<row r="1"><c r="A1" t="s"><v>0</v></c><c r="B1" t="inlineStr"><is><t>Qty</t></is></c></row>' +
    '<row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>18247.5</v></c><c r="C2"><f>B2*2</f><v>36495</v></c><c r="D2" s="3"/></row>' +
    '<row r="3"><c r="A3" t="b"><v>1</v></c></row>' +
    "</sheetData></worksheet>";
  const sheet2 = '<worksheet><sheetData><row r="1"><c r="AA1"><v>7</v></c></row></sheetData></worksheet>';
  return writeZip([
    { name: "[Content_Types].xml", data: ct },
    { name: "xl/workbook.xml", data: wb },
    { name: "xl/_rels/workbook.xml.rels", data: rels },
    { name: "xl/sharedStrings.xml", data: ss },
    { name: "xl/worksheets/sheet1.xml", data: sheet1 },
    { name: "xl/worksheets/sheet2.xml", data: sheet2 },
  ]);
}

describe("parseXlsx", () => {
  it("reads sheets, shared and inline strings, numbers, booleans and formulas", () => {
    const wb = parseXlsx(xlsxFixture());
    expect(wb.sheets.map((s) => s.name)).toEqual(["Inputs & Bills", "Output"]);
    const s1 = wb.sheets[0]!;
    expect(cellAt(s1, "A1")?.value).toBe("Fuel");
    expect(cellAt(s1, "B1")?.value).toBe("Qty");
    expect(cellAt(s1, "A2")?.value).toBe("Coal A&B");
    expect(cellAt(s1, "B2")?.value).toBe(18247.5);
    expect(cellAt(s1, "C2")).toMatchObject({ value: 36495, formula: "B2*2" });
    expect(cellAt(s1, "A3")?.value).toBe(true);
    expect(cellAt(s1, "D2")).toBeUndefined();
    expect(sheetRows(s1)[1]![1]).toBe(18247.5);
    expect(cellAt(wb.sheets[1]!, "AA1")?.value).toBe(7);
  });

  it("converts cell references both ways", () => {
    expect(parseCellRef("AB12")).toEqual({ col: 28, row: 12 });
    expect(parseCellRef("12AB")).toBeNull();
    expect(parseCellRef("A0")).toBeNull();
    expect(columnLetters(28)).toBe("AB");
    expect(columnLetters(1)).toBe("A");
  });

  it("refuses non-workbooks and applies the sheet cap", () => {
    expect(() => parseXlsx(new Uint8Array(50))).toThrow(XlsxError);
    expect(() => parseXlsx(writeZip([{ name: "a.txt", data: "x" }]))).toThrow(/workbook/);
    expect(() => parseXlsx(xlsxFixture(), { maxSheets: 1, maxCellsPerSheet: 10 })).toThrow(/limit/);
  });

  it("flags truncation instead of silently dropping cells", () => {
    const wb = parseXlsx(xlsxFixture(), { maxSheets: 5, maxCellsPerSheet: 2 });
    expect(wb.sheets[0]!.truncated).toBe(true);
  });
});

describe("parseTimestamp", () => {
  it("reads ISO with and without a zone, and day-first Indian formats", () => {
    expect(parseTimestamp("2025-04-01T00:00:00Z", 330)).toBe(Date.UTC(2025, 3, 1));
    expect(parseTimestamp("2025-04-01 05:30:00", 330)).toBe(Date.UTC(2025, 3, 1));
    expect(parseTimestamp("2025-04-01T05:30:00+05:30", 0)).toBe(Date.UTC(2025, 3, 1));
    expect(parseTimestamp("01/04/2025 05:30", 330)).toBe(Date.UTC(2025, 3, 1));
  });

  it("rejects impossible dates and junk", () => {
    expect(parseTimestamp("31/02/2025 00:00", 330)).toBeNull();
    expect(parseTimestamp("2025-13-01", 330)).toBeNull();
    expect(parseTimestamp("yesterday", 330)).toBeNull();
    expect(parseTimestamp("", 330)).toBeNull();
  });
});

describe("normaliseTimeSeries", () => {
  const wide = [
    ["Timestamp", "kiln_amps", "grid_kwh"],
    ["2025-04-01 00:00", "100", "10"],
    ["2025-04-01 00:15", "110", "n/a"],
    ["2025-04-01 00:15", "999", "12"], // duplicate timestamp
    ["2025-04-01 00:30", "120", "14"],
    ["2025-04-01 02:30", "130", "16"], // gap
    ["bad", "1", "1"],
  ];

  it("normalises a wide export and reports every repair", () => {
    const r = normaliseTimeSeries(wide);
    expect(r.layout).toBe("wide");
    const kiln = r.summaries.find((s) => s.tag === "kiln_amps")!;
    expect(kiln.count).toBe(4);
    expect(kiln.duplicateTimestamps).toBe(1);
    expect(kiln.max).toBe(130); // 999 was the dropped duplicate
    expect(kiln.gapCount).toBe(1);
    const grid = r.summaries.find((s) => s.tag === "grid_kwh")!;
    expect(grid.droppedNonNumeric).toBe(1);
    expect(r.warnings.join(" ")).toMatch(/timestamp not recognised/);
  });

  it("reads the long layout", () => {
    const r = normaliseTimeSeries([
      ["DateTime", "Tag", "Value"],
      ["2025-04-01 00:00", "A", "1"],
      ["2025-04-01 00:01", "B", "2"],
      ["2025-04-01 00:02", "A", "3"],
    ]);
    expect(r.layout).toBe("long");
    expect(r.summaries.map((s) => [s.tag, s.count])).toEqual([["A", 2], ["B", 1]]);
  });

  it("refuses a file with no timestamp column or no numbers", () => {
    expect(() => normaliseTimeSeries([["a", "b"], ["1", "2"]])).toThrow(TimeSeriesError);
    expect(() => normaliseTimeSeries([["Timestamp", "x"], ["2025-04-01", "abc"]])).toThrow(/No numeric/);
  });

  it("aggregates a window with its row count, for provenance", () => {
    const r = normaliseTimeSeries(wide);
    const pts = r.series.get("grid_kwh")!;
    // 00:00 to 00:30 IST, end inclusive: readings 10, 12, 14
    const agg = aggregateRange(pts, "2025-03-31T18:30:00Z", "2025-03-31T19:00:00Z", "sum");
    expect(agg).toMatchObject({ value: 36, rowCount: 3 });
    expect(aggregateRange(pts, "2030-01-01T00:00:00Z", "2030-01-02T00:00:00Z", "sum")).toBeNull();
    expect(() => aggregateRange(pts, "2025-04-02T00:00:00Z", "2025-04-01T00:00:00Z", "sum")).toThrow(TimeSeriesError);
  });
});
