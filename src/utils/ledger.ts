// utils/ledger.ts
// The single place a Transaction is ever created and Business cash/bank
// balances are ever mutated for Business Mode. Sale/Purchase/Expense/Payment
// controllers all funnel through this instead of writing balances directly,
// so financial math never gets duplicated (or drifts) across controllers.
import { ClientSession, Types } from 'mongoose';
import Transaction, { TransactionType } from '../models/transaction.model';
import Business from '../models/business.model';
import { round2 } from './money';

export interface RecordEntryInput {
  business: Types.ObjectId;
  type: TransactionType;
  amount: number; // revenue/expense figure shown in reports — not necessarily the cash delta
  category: Types.ObjectId;
  note?: string;
  reference?: string;
  attachmentUrl?: string;
  createdBy: Types.ObjectId;
  member: Types.ObjectId;
  paymentMethod?: 'cash' | 'bank' | 'bkash' | 'nagad' | 'other';
  customer?: Types.ObjectId | null;
  supplier?: Types.ObjectId | null;
  source?: { type: 'sale' | 'purchase' | 'expense' | 'payment'; id: Types.ObjectId } | null;
  date?: Date;
  // Actual cash/bank movement — decoupled from `amount` because e.g. a credit
  // sale recognizes full revenue but only the paid portion touches the till.
  cashDelta?: number;
  bankDelta?: number;
}

export const recordLedgerEntry = async (input: RecordEntryInput, session: ClientSession) => {
  const [transaction] = await Transaction.create(
    [
      {
        business: input.business,
        type: input.type,
        amount: input.amount,
        category: input.category,
        note: input.note,
        reference: input.reference,
        attachmentUrl: input.attachmentUrl,
        createdBy: input.createdBy,
        member: input.member,
        paymentMethod: input.paymentMethod,
        customer: input.customer ?? null,
        supplier: input.supplier ?? null,
        source: input.source ?? null,
        date: input.date ?? new Date(),
        cashDelta: input.cashDelta ?? 0,
        bankDelta: input.bankDelta ?? 0,
        balanceApplied: true,
        splitType: 'none',
        settlementStatus: 'not_applicable',
      },
    ],
    { session },
  );

  await applyBalanceDelta(input.business, input.cashDelta ?? 0, input.bankDelta ?? 0, session);

  return transaction;
};

/** Move Business.cashBalance / bankBalance (no-op for zero deltas). */
export const applyBalanceDelta = async (
  business: Types.ObjectId,
  cashDelta: number,
  bankDelta: number,
  session: ClientSession,
) => {
  if (cashDelta === 0 && bankDelta === 0) return;
  await Business.findByIdAndUpdate(
    business,
    { $inc: { cashBalance: round2(cashDelta), bankBalance: round2(bankDelta) } },
    { session },
  );
};

/**
 * Which transactions count as income / expense in summaries.
 *
 * - A customer or supplier payment settles a sale or purchase that was
 *   already counted in full when it was made; counting the payment again
 *   doubled income (a ৳1000 credit sale + its ৳1000 receipt showed ৳2000).
 * - The opening balance (isAdjustment) is money the business already had,
 *   not income.
 */
export const REPORTABLE_MATCH = {
  isAdjustment: { $ne: true },
  'source.type': { $ne: 'payment' },
} as const;

/** The same rule for transactions already loaded into memory. */
export const isReportable = (t: { isAdjustment?: boolean; source?: { type?: string } | null }) =>
  !t.isAdjustment && t.source?.type !== 'payment';

// A payment method resolves to either the cash or bank bucket — bkash/nagad/other
// are treated as "bank-equivalent" (electronic, not physical till) since the
// Business model only tracks two balances.
export const balanceDeltaFor = (paymentMethod: string | undefined, amount: number) => {
  if (paymentMethod === 'cash') return { cashDelta: amount, bankDelta: 0 };
  return { cashDelta: 0, bankDelta: amount };
};

// Attachments (receipt photo / PDF) are uploaded straight to Cloudinary by the
// client; the backend only stores the resulting URL. Accept http(s) URLs only so
// a `javascript:` or `data:` URL can never end up rendered as a link.
export const sanitizeAttachmentUrl = (value: unknown): string | undefined => {
  if (typeof value !== 'string') return undefined;
  const url = value.trim();
  if (!url || url.length > 2048) return undefined;
  try {
    const { protocol } = new URL(url);
    return protocol === 'https:' || protocol === 'http:' ? url : undefined;
  } catch {
    return undefined;
  }
};
