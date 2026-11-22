// utils/money.ts
// Every amount that arrives in a request body goes through here before any
// arithmetic. JSON numbers can arrive as strings ("5"), and `100 - 10 + "5"`
// is "905" in JavaScript: the tax was concatenated onto the total.
import ApiError from '../Error/handleApiError';

/** Round to paisa (2 decimals), avoiding the 1.005 → 1.00 binary trap. */
export const round2 = (n: number): number => Math.round((n + Number.EPSILON) * 100) / 100;

interface AmountOptions {
  /** Value used when the field is missing or empty (default 0). */
  fallback?: number;
  /** Reject 0 as well as negatives. */
  positive?: boolean;
}

/**
 * A request amount as a finite, non-negative number rounded to paisa.
 * Numeric strings are accepted; anything else is a 400 naming the field.
 */
export const toAmount = (value: unknown, field: string, opts: AmountOptions = {}): number => {
  if (value === undefined || value === null || value === '') {
    if (opts.positive) throw new ApiError(400, `${field} must be greater than 0`);
    return opts.fallback ?? 0;
  }
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n)) throw new ApiError(400, `${field} must be a number`);
  if (n < 0) throw new ApiError(400, `${field} cannot be negative`);
  const rounded = round2(n);
  if (opts.positive && rounded <= 0) throw new ApiError(400, `${field} must be greater than 0`);
  return rounded;
};

/** A quantity: finite and > 0, up to 3 decimals (kg, litre). */
export const toQuantity = (value: unknown, field = 'Quantity'): number => {
  const n = typeof value === 'number' ? value : typeof value === 'string' ? Number(value.trim()) : NaN;
  if (!Number.isFinite(n) || n <= 0) throw new ApiError(400, `${field} must be greater than 0`);
  return Math.round((n + Number.EPSILON) * 1000) / 1000;
};
