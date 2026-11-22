// utils/saleReturn.ts
// The arithmetic of a sale return / cancellation, kept pure so it can be tested.
import ApiError from '../Error/handleApiError';
import { round2, toQuantity } from './money';

export interface SaleSnapshot {
  items: { product: { toString(): string }; productName: string; quantity: number; unitPrice: number; returnedQuantity?: number }[];
  subtotal: number;
  total: number;
  paidAmount: number;
  dueAmount: number;
  returnedTotal?: number;
}

export interface ReturnRequestLine {
  product: string;
  quantity: unknown;
}

export interface ReturnPlan {
  lines: { index: number; product: string; productName: string; quantity: number; amount: number }[];
  /** Value of what comes back, after the sale's discount/tax share. */
  amount: number;
  /** Taken off what the customer still owes first … */
  dueReduced: number;
  /** … and only the rest is paid back. */
  refunded: number;
  /** Every unit of every line is back: the sale is cancelled. */
  fullyReturned: boolean;
}

/**
 * Plan a return. `requested` null/undefined means "everything still unreturned"
 * (cancel). Each line's value is quantity × unit price scaled by total/subtotal,
 * so the sale's discount and tax are given back in proportion.
 */
export const planSaleReturn = (sale: SaleSnapshot, requested?: ReturnRequestLine[] | null): ReturnPlan => {
  const remaining = sale.items.map((it) => round3(it.quantity - (it.returnedQuantity ?? 0)));
  const wanted = new Array(sale.items.length).fill(0) as number[];

  if (!requested) {
    remaining.forEach((r, i) => (wanted[i] = r));
  } else {
    if (!Array.isArray(requested) || requested.length === 0) throw new ApiError(400, 'Choose at least one item to return');
    for (const line of requested) {
      const index = sale.items.findIndex((it) => it.product.toString() === String(line?.product));
      if (index < 0) throw new ApiError(400, 'That product is not on this sale');
      wanted[index] = round3(wanted[index] + toQuantity(line.quantity, 'Return quantity'));
    }
  }

  wanted.forEach((q, i) => {
    if (q > remaining[i] + 1e-9) {
      throw new ApiError(400, `Only ${remaining[i]} of "${sale.items[i].productName}" can still be returned`);
    }
  });
  if (wanted.every((q) => q <= 0)) throw new ApiError(400, 'Nothing left to return on this sale');

  const factor = sale.subtotal > 0 ? sale.total / sale.subtotal : 0;
  const lines = wanted
    .map((quantity, index) => ({
      index,
      product: sale.items[index].product.toString(),
      productName: sale.items[index].productName,
      quantity,
      amount: round2(quantity * sale.items[index].unitPrice * factor),
    }))
    .filter((l) => l.quantity > 0);

  const fullyReturned = wanted.every((q, i) => Math.abs(q - remaining[i]) < 1e-9);
  const stillOpen = round2(sale.total - (sale.returnedTotal ?? 0));
  // The last return takes exactly what is left, so rounding never leaves a paisa behind.
  const amount = fullyReturned ? stillOpen : Math.min(stillOpen, round2(lines.reduce((s, l) => s + l.amount, 0)));
  const dueReduced = round2(Math.min(sale.dueAmount, amount));
  const refunded = round2(Math.min(sale.paidAmount, amount - dueReduced));

  return { lines, amount, dueReduced, refunded, fullyReturned };
};

const round3 = (n: number) => Math.round((n + Number.EPSILON) * 1000) / 1000;
