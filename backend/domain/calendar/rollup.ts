import type {
  StreamDefinition,
  CalendarReading,
  AnnualRollup,
  MonthCell,
} from "./types";

/**
 * Computes the variance percentage between different sources in a cell.
 * Returns null if fewer than 2 sources are present.
 */
export function computeCellVariance(cell: {
  sourcing?: CalendarReading;
  corroboration?: CalendarReading;
  proforma?: CalendarReading;
}): { variancePercent: number | null; hasVarianceAlert: boolean } {
  const vals: number[] = [];
  if (cell.sourcing && Number.isFinite(cell.sourcing.standardValue)) {
    vals.push(cell.sourcing.standardValue);
  }
  if (cell.corroboration && Number.isFinite(cell.corroboration.standardValue)) {
    vals.push(cell.corroboration.standardValue);
  }
  if (cell.proforma && Number.isFinite(cell.proforma.standardValue)) {
    vals.push(cell.proforma.standardValue);
  }

  if (vals.length < 2) {
    return { variancePercent: null, hasVarianceAlert: false };
  }

  // Calculate percentage difference: |max - min| / ((max + min) / 2) * 100
  const max = Math.max(...vals);
  const min = Math.min(...vals);
  if (max === 0 && min === 0) {
    return { variancePercent: 0, hasVarianceAlert: false };
  }
  const avg = (max + min) / 2;
  const diff = max - min;
  const variancePercent = avg > 0 ? (diff / avg) * 100 : 0;
  // Rounded to 2 decimal places
  const rounded = Math.round(variancePercent * 100) / 100;
  // Variance > 5% is flagged as an audit alert under CCTS / PAT guidelines
  const hasVarianceAlert = rounded > 5;

  return { variancePercent: rounded, hasVarianceAlert };
}

/**
 * Computes the verified Annual Roll-Up for a stream across the 12 fiscal months.
 * Code computes; models never do.
 */
export function computeAnnualRollup(
  stream: StreamDefinition,
  monthlyCells: MonthCell[],
  proformaAnnualReading?: CalendarReading,
  weightReadingsByMonth?: Map<string, number>
): AnnualRollup {
  // Collect the primary representative value for each month:
  // Priority: sourcing > corroboration > proforma
  const monthlyValues: { monthKey: string; value: number }[] = [];

  for (const cell of monthlyCells) {
    const reading = cell.sourcing ?? cell.corroboration ?? cell.proforma;
    if (reading && Number.isFinite(reading.standardValue)) {
      monthlyValues.push({
        monthKey: cell.monthKey,
        value: reading.standardValue,
      });
    }
  }

  const completedMonthsCount = monthlyValues.length;
  const isComplete = completedMonthsCount === 12;

  let rolledUpValue: number | null = null;

  if (monthlyValues.length > 0) {
    if (stream.aggregation === "sum") {
      // Sum all monthly quantities
      rolledUpValue = monthlyValues.reduce((acc, curr) => acc + curr.value, 0);
    } else if (stream.aggregation === "weighted_mean") {
      // Weighted mean using weight readings (e.g. GCV weighted by coal consumption)
      let weightedSum = 0;
      let totalWeight = 0;

      for (const mv of monthlyValues) {
        const weight = weightReadingsByMonth?.get(mv.monthKey) ?? 1;
        weightedSum += mv.value * weight;
        totalWeight += weight;
      }

      rolledUpValue = totalWeight > 0 ? weightedSum / totalWeight : null;
    } else {
      // latest
      rolledUpValue = monthlyValues[monthlyValues.length - 1].value;
    }
  } else if (proformaAnnualReading && Number.isFinite(proformaAnnualReading.standardValue)) {
    // If no monthly readings exist yet, fall back to the proforma annual reading if available
    rolledUpValue = proformaAnnualReading.standardValue;
  }

  if (rolledUpValue !== null) {
    // Round to 3 decimal places for stability
    rolledUpValue = Math.round(rolledUpValue * 1000) / 1000;
  }

  const proformaAnnual = proformaAnnualReading?.standardValue ?? null;
  let varianceToProformaPercent: number | null = null;

  if (rolledUpValue !== null && proformaAnnual !== null && proformaAnnual > 0) {
    const diff = Math.abs(rolledUpValue - proformaAnnual);
    varianceToProformaPercent = Math.round((diff / proformaAnnual) * 10000) / 100;
  }

  // Determine the primary source type of the roll-up
  const hasSourcing = monthlyCells.some((c) => Boolean(c.sourcing));
  const hasCorroboration = monthlyCells.some((c) => Boolean(c.corroboration));
  const sourceType = hasSourcing ? "sourcing" : hasCorroboration ? "corroboration" : "proforma";

  return {
    value: rolledUpValue,
    unit: stream.standardUnit,
    aggregation: stream.aggregation,
    completedMonthsCount,
    totalMonthsCount: 12,
    isComplete,
    proformaAnnual,
    varianceToProformaPercent,
    sourceType,
  };
}
