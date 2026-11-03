/**
 * One calculation input, located in the master pro forma workbook by its label.
 * Pack data, so a new sector adds rows here and not code.
 */
export interface ProformaInput {
  /** Fact path the value becomes, or null when the workbook holds an input the pack has no stream for. */
  fieldPath: string | null;
  /** Regular expression (case-insensitive) for the label in column A. */
  label: string;
  /** Regular expression (case-insensitive) for the sheet name. */
  sheet: string;
  /** Unit the fact is stored in. */
  unit: string;
  /** Multiply the workbook value by this to get the fact unit. For example 100000 for Lakh kWh to kWh. */
  scale?: number;
  /** Plain-language name shown when the row is missing. */
  description: string;
  note?: string;
}
