// utils/ledger.ts
// The single place a Transaction is ever created and Business cash/bank
// balances are ever mutated for Business Mode. Sale/Purchase/Expense/Payment
// controllers all funnel through this instead of writing balances directly,
// so financial math never gets duplicated (or drifts) across controllers.
import { ClientSession, Types } from 'mongoose';
import Transaction, { TransactionType } from '../models/transaction.model';
import Business from '../models/business.model';

export interface RecordEntryInput {
  business: Types.ObjectId;
  type: TransactionType;
  amount: number; // revenue/expense figure shown in reports — not necessarily the cash delta
  category: Types.ObjectId;
  note?: string;
  reference?: string;
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
        createdBy: input.createdBy,
        member: input.member,
        paymentMethod: input.paymentMethod,
        customer: input.customer ?? null,
        supplier: input.supplier ?? null,
        source: input.source ?? null,
        date: input.date ?? new Date(),
        splitType: 'none',
        settlementStatus: 'not_applicable',
      },
    ],
    { session },
  );

  const cashDelta = input.cashDelta ?? 0;
  const bankDelta = input.bankDelta ?? 0;
  if (cashDelta !== 0 || bankDelta !== 0) {
    await Business.findByIdAndUpdate(
      input.business,
      { $inc: { cashBalance: cashDelta, bankBalance: bankDelta } },
      { session },
    );
  }

  return transaction;
};

// A payment method resolves to either the cash or bank bucket — bkash/nagad/other
// are treated as "bank-equivalent" (electronic, not physical till) since the
// Business model only tracks two balances.
export const balanceDeltaFor = (paymentMethod: string | undefined, amount: number) => {
  if (paymentMethod === 'cash') return { cashDelta: amount, bankDelta: 0 };
  return { cashDelta: 0, bankDelta: amount };
};
