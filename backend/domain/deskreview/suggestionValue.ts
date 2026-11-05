/**
 * What a proposed reading puts in the box when the auditor presses Apply.
 *
 * A proposal carries a quantity (`value`), a word (`text`, such as the moisture basis on a laboratory
 * certificate) or a series typed one row per line (`rawText`). Applying one used to read `value`
 * alone, so a word reading went into the box as the string "undefined". This is the one place that
 * decides, and it never invents an entry: a proposal with nothing usable returns null and is left
 * out, not written as a placeholder.
 */

export interface SuggestionFigure {
  value?: number;
  text?: string;
  rawText?: string;
}

/** The text for the reading's input, or null when the proposal holds nothing to enter. */
export function suggestionInput(s: SuggestionFigure): string | null {
  if (typeof s.rawText === "string" && s.rawText.trim() !== "") return s.rawText;
  if (typeof s.text === "string" && s.text.trim() !== "") return s.text.trim();
  if (typeof s.value === "number" && Number.isFinite(s.value)) return String(s.value);
  return null;
}

/** The figure as shown in the suggestion banner and the toast, with its unit when it has one. */
export function suggestionShown(s: SuggestionFigure, unit: string): string {
  const rows = typeof s.rawText === "string" ? s.rawText.split("\n").filter((l) => l.trim() !== "").length : 0;
  if (rows > 1) return `${rows} dated rows`;
  const entered =
    typeof s.text === "string" && s.text.trim() !== ""
      ? s.text.trim()
      : typeof s.value === "number" && Number.isFinite(s.value)
        ? String(s.value)
        : null;
  if (entered === null) return "nothing readable";
  return unit ? `${entered} ${unit}` : entered;
}

/**
 * A comparable identity for a proposed figure, so two documents can be checked for printing the
 * same one. Numbers compare as numbers and words compare ignoring case and spacing.
 */
export function suggestionIdentity(s: SuggestionFigure): string {
  if (typeof s.value === "number") return `n:${s.value}`;
  if (typeof s.text === "string") return `t:${s.text.trim().toLowerCase().replace(/\s+/g, " ")}`;
  return "none";
}
