// Rounding on the decimal value a person typed, not on its binary approximation.
//
// 84.85 is stored as 84.849999999999994315…, so Math.round-style rounding shows 84.8 where the
// label must show 84.9. Every value is first reduced to 15 significant digits, which removes
// binary noise from inputs of up to 15 digits, then rounded half up with integer arithmetic.

/** A decimal number: sign × coefficient × 10^exponent. */
interface Decimal {
  readonly negative: boolean;
  readonly coefficient: bigint;
  readonly exponent: number;
}

function toDecimal(value: number): Decimal {
  if (!Number.isFinite(value)) throw new RangeError(`Not a finite number: ${value}`);
  const [mantissa = '0', exponent = '0'] = Math.abs(value).toExponential(14).split('e');
  return {
    negative: value < 0,
    coefficient: BigInt(mantissa.replace('.', '')),
    exponent: Number(exponent) - 14,
  };
}

/** Removes trailing zero digits from the coefficient: 3552000 × 10^-4 becomes 3552 × 10^-1. */
function normalise(d: Decimal): Decimal {
  if (d.coefficient === 0n) return { negative: false, coefficient: 0n, exponent: 0 };
  let { coefficient, exponent } = d;
  while (coefficient % 10n === 0n) {
    coefficient /= 10n;
    exponent += 1;
  }
  return { negative: d.negative, coefficient, exponent };
}

/** Drops the last `count` digits of the coefficient, rounding half away from zero. */
function dropDigits(d: Decimal, count: number): Decimal {
  if (count <= 0) return d;
  const divisor = 10n ** BigInt(count);
  let coefficient = d.coefficient / divisor;
  if ((d.coefficient % divisor) * 2n >= divisor) coefficient += 1n;
  return { negative: d.negative, coefficient, exponent: d.exponent + count };
}

function digitCount(n: bigint): number {
  return n.toString().length;
}

function toPlainString(d: Decimal, minFractionDigits = 0): string {
  let { coefficient, exponent } = normalise(d);
  // Pad with zeros to reach the minimum number of decimal places.
  if (-exponent < minFractionDigits) {
    coefficient *= 10n ** BigInt(minFractionDigits + exponent);
    exponent = -minFractionDigits;
  }
  let text: string;
  if (exponent >= 0) {
    text = coefficient.toString() + '0'.repeat(exponent);
  } else {
    const digits = coefficient.toString().padStart(-exponent + 1, '0');
    text = `${digits.slice(0, exponent)}.${digits.slice(exponent)}`;
  }
  return d.negative && coefficient !== 0n ? `-${text}` : text;
}

/**
 * Rounds to at most `figures` significant figures and never adds trailing precision:
 * 355.2 → "355", 84.89 → "84.9", 1234.5 → "1230", 12.04 → "12".
 */
export function formatSignificant(value: number, figures: number): string {
  const d = normalise(toDecimal(value));
  if (d.coefficient === 0n) return '0';
  return toPlainString(dropDigits(d, digitCount(d.coefficient) - figures));
}

/** Rounds to exactly `places` decimal places: 0.9989 → "1.0", 39.45 → "39.5". */
export function formatFixed(value: number, places: number): string {
  const d = toDecimal(value);
  return toPlainString(dropDigits(d, -places - d.exponent), places);
}

/** Rounds to at most `places` decimal places without trailing zeros: 60 → "60", 37.55 → "37.6". */
export function formatUpTo(value: number, places: number): string {
  const d = toDecimal(value);
  return toPlainString(dropDigits(d, -places - d.exponent));
}

/** True when the value is a whole number once binary noise is removed. */
export function isWholeNumber(value: number): boolean {
  return normalise(toDecimal(value)).exponent >= 0;
}

/** Number of decimal places the value needs once binary noise is removed: 37.5 → 1, 60 → 0. */
export function decimalPlaces(value: number): number {
  return Math.max(0, -normalise(toDecimal(value)).exponent);
}

/**
 * Significant figures shown by a displayed number. Leading zeros never count; trailing zeros of
 * a whole number are treated as placeholders ("1230" has three), and trailing zeros after a
 * decimal point count ("12.0" has three).
 */
export function countSignificantFigures(displayed: string): number {
  const text = displayed.replace(/^-/, '');
  if (!/^\d+(\.\d+)?$/.test(text)) throw new RangeError(`Not a plain decimal: "${displayed}"`);
  const digits = text.includes('.')
    ? text.replace('.', '').replace(/^0+/, '')
    : text.replace(/^0+/, '').replace(/0+$/, '');
  return digits.length;
}
