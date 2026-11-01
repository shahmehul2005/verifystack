/**
 * Digit-pattern screens for manually typed quantities (Process 13.3).
 *
 * This is a screen, not a finding. Plants type hundreds of weighbridge numbers and
 * daily fuel logs into spreadsheets by hand, and a number typed by a person is not a
 * number read by a machine. Two patterns are worth looking at:
 *
 *   Benford's law. In a large set of naturally occurring quantities the first digit
 *   is 1 about 30% of the time and 9 about 5%. Fabricated or constrained numbers
 *   drift away from that shape.
 *
 *   Terminal digits. Weights and quantities from a weighbridge should end in every
 *   digit about equally often. Rounding everything to 0 or 5, or ending slips in a
 *   favourite digit, does not happen by chance.
 *
 * Neither test says a number is wrong. A set of fifty values that are deliberately
 * round, or a small sample, will trip them innocently. The result is a p-value and a
 * note, so a verifier can decide whether to pull the slips and look.
 */

/** Benford's expected share of each leading digit, 1 to 9. */
export const BENFORD_P1 = Array.from({ length: 9 }, (_, i) => Math.log10(1 + 1 / (i + 1)));

export interface DigitScreen {
  /** Values the test actually used. */
  n: number;
  /** Chi-square statistic. */
  chiSquare: number;
  /** Degrees of freedom: 8 for first digits, 9 for terminal digits. */
  df: number;
  /** Upper-tail probability under the null hypothesis. Below 0.01 is a strong signal, below 0.05 worth a look. */
  pValue: number;
  /** Observed count per bucket, from 1 or from 0. */
  observed: number[];
  /** Expected count per bucket. */
  expected: number[];
  /** True when the sample is smaller than the screen is willing to judge. */
  smallSample: boolean;
}

/** The smallest sample this screen will judge. Below it, a chi-square is noise. */
export const MIN_SCREEN_SAMPLE = 30;

/** Leading digit of a positive number, or null when there is none. */
export function firstDigit(value: number): number | null {
  if (!Number.isFinite(value) || value === 0) return null;
  const digits = Math.abs(value).toExponential().replace(/[^0-9]/g, "");
  const first = Number(digits[0]);
  return first >= 1 && first <= 9 ? first : null;
}

/** Last digit of the value as written in decimal, without an exponent. */
export function terminalDigit(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  // Above this, JavaScript switches to exponential notation and the written last digit
  // is no longer recoverable. A quantity that large is not a weighbridge reading.
  if (Math.abs(value) >= 1e21) return null;
  // toFixed keeps a plain decimal and never produces an exponent, so the last
  // character is the last digit the number carries.
  const text = Math.abs(value).toFixed(10).replace(/\.?0+$/, "");
  const last = text.at(-1);
  return last && /\d/.test(last) ? Number(last) : 0;
}

/**
 * Terminal digit of the number as a person typed it, taken from the text rather than
 * from the float. "1250" ends in 0; 1250 ends in 0 too, but "1250.0" also does, and a
 * typed decimal keeps its own last character. Values with no digits are skipped.
 */
export function terminalDigitOfText(text: string): number | null {
  const cleaned = text.replace(/[^0-9.]/g, "").replace(/\.$/, "");
  if (cleaned === "") return null;
  const last = cleaned.at(-1);
  return last && /\d/.test(last) ? Number(last) : null;
}

/** Upper tail of the chi-square distribution, by the regularized incomplete gamma. */
export function chiSquarePValue(chiSquare: number, df: number): number {
  if (!Number.isFinite(chiSquare) || chiSquare < 0 || df <= 0) return Number.NaN;
  // P(X > x) = Q(df/2, x/2), the regularized upper incomplete gamma.
  return gammaQ(df / 2, chiSquare / 2);
}

function gammaQ(a: number, x: number): number {
  if (x <= 0) return 1;
  if (x < a + 1) return 1 - gammaPSeries(a, x);
  return gammaQContinuedFraction(a, x);
}

function gammaPSeries(a: number, x: number): number {
  let sum = 1 / a;
  let term = sum;
  for (let n = 1; n < 500; n += 1) {
    term *= x / (a + n);
    sum += term;
    if (Math.abs(term) < Math.abs(sum) * 1e-15) break;
  }
  return sum * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

function gammaQContinuedFraction(a: number, x: number): number {
  const tiny = 1e-300;
  let b = x + 1 - a;
  let c = 1 / tiny;
  let d = 1 / b;
  let h = d;
  for (let i = 1; i < 500; i += 1) {
    const an = -i * (i - a);
    b += 2;
    d = an * d + b;
    if (Math.abs(d) < tiny) d = tiny;
    c = b + an / c;
    if (Math.abs(c) < tiny) c = tiny;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 1e-15) break;
  }
  return h * Math.exp(-x + a * Math.log(x) - logGamma(a));
}

/** Lanczos approximation of ln Γ(x), for x > 0. */
function logGamma(x: number): number {
  const g = 7;
  const coef = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028, 771.32342877765313, -176.61502916214059,
    12.507343278686905, -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  const z = x - 1;
  let a = coef[0]!;
  const t = z + g + 0.5;
  for (let i = 1; i < coef.length; i += 1) a += coef[i]! / (z + i);
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(a);
}

function screen(counts: number[], expected: number[], df: number): DigitScreen {
  const n = counts.reduce((a, b) => a + b, 0);
  let chi = 0;
  for (let i = 0; i < counts.length; i += 1) {
    const e = expected[i]!;
    if (e > 0) chi += (counts[i]! - e) ** 2 / e;
  }
  return {
    n,
    chiSquare: chi,
    df,
    pValue: n >= MIN_SCREEN_SAMPLE ? chiSquarePValue(chi, df) : Number.NaN,
    observed: counts,
    expected,
    smallSample: n < MIN_SCREEN_SAMPLE,
  };
}

/** Benford's first-digit test. Values must be positive quantities on one scale. */
export function benfordFirstDigit(values: readonly number[]): DigitScreen {
  const counts = Array.from({ length: 9 }, () => 0);
  for (const v of values) {
    const d = firstDigit(v);
    if (d !== null) counts[d - 1]! += 1;
  }
  const n = counts.reduce((a, b) => a + b, 0);
  return screen(counts, BENFORD_P1.map((p) => p * n), 8);
}

/** Terminal-digit uniformity test. Every last digit should be about equally likely. */
export function terminalDigitUniformity(values: readonly number[]): DigitScreen {
  const counts = Array.from({ length: 10 }, () => 0);
  for (const v of values) {
    const d = terminalDigit(v);
    if (d !== null) counts[d]! += 1;
  }
  const n = counts.reduce((a, b) => a + b, 0);
  return screen(counts, Array.from({ length: 10 }, () => n / 10), 9);
}

/** Share of values ending in 0 or 5. A set of weighbridge weights should not be mostly round. */
export function roundEndingShare(values: readonly number[]): { share: number; n: number } {
  const digits = values.map(terminalDigit).filter((d): d is number => d !== null);
  if (digits.length === 0) return { share: 0, n: 0 };
  const round = digits.filter((d) => d === 0 || d === 5).length;
  return { share: round / digits.length, n: digits.length };
}

/**
 * Whether Benford's law can be applied to a set at all.
 *
 * Benford describes quantities spanning several orders of magnitude. A set where every
 * value is 4,117 to 4,252 kcal/kg has no first-digit distribution to test: almost every
 * value starts with 4, and the test reports a decisive deviation that means nothing.
 * The same is true of a set that spans more than three orders of magnitude, which is
 * usually a mixture of different quantities rather than one population.
 *
 * The screen therefore declines rather than failing. This is the difference between a
 * check that is wrong and a check that knows its own limits.
 */
export function benfordApplies(values: readonly number[]): { ok: true } | { ok: false; reason: string } {
  const positive = values.filter((v) => Number.isFinite(v) && v > 0);
  if (positive.length === 0) return { ok: false, reason: "There are no positive values to test." };
  const min = Math.min(...positive);
  const max = Math.max(...positive);
  const decades = Math.log10(max / min);
  if (decades < 1) {
    return {
      ok: false,
      reason: `Every value lies between ${round2(min)} and ${round2(max)}, within one order of magnitude, so a first-digit distribution is not a Benford population.`,
    };
  }
  if (decades > 3) {
    return {
      ok: false,
      reason: `The values span ${round2(decades)} orders of magnitude (${round2(min)} to ${round2(max)}), which is more likely a mixture of quantities than one population.`,
    };
  }
  return { ok: true };
}

const round2 = (n: number) => Math.round(n * 100) / 100;

/** A one-line note for a screen, for the check's detail. Never a verdict on its own. */
export function describeScreen(label: string, s: DigitScreen): string {
  if (s.smallSample) {
    return `${label}: ${s.n} values, fewer than the ${MIN_SCREEN_SAMPLE} this screen needs, so nothing is concluded.`;
  }
  const verdict = s.pValue < 0.01 ? "a strong deviation" : s.pValue < 0.05 ? "a deviation worth looking at" : "no significant deviation";
  return `${label}: ${s.n} values, chi-square ${s.chiSquare.toFixed(2)} on ${s.df} degrees of freedom, p ${s.pValue.toFixed(4)}: ${verdict}.`;
}
