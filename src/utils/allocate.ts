// utils/allocate.ts
// Applying a customer receipt (or a supplier payment) to the open invoices it
// pays off, oldest first. Before this, a payment only changed the party's
// totals: a ৳1000 credit sale stayed "due" after the customer paid ৳1000.
import { ClientSession, Model, Types } from 'mongoose';
import { round2 } from './money';

export interface OpenDoc {
  _id: Types.ObjectId;
  total: number;
  paidAmount: number;
  dueAmount: number;
}

export interface AllocationLine {
  id: Types.ObjectId;
  applied: number;
  paidAmount: number;
  dueAmount: number;
  status: 'paid' | 'partial' | 'due';
}

export const statusFor = (paid: number, due: number): 'paid' | 'partial' | 'due' =>
  due <= 0 ? 'paid' : paid <= 0 ? 'due' : 'partial';

/**
 * Pure: spread `amount` over `docs` (already sorted oldest first). Whatever
 * is left after every invoice is paid settles the party's opening balance,
 * which has no invoice, so it is returned as `unapplied`.
 */
export const planAllocation = (docs: OpenDoc[], amount: number) => {
  let left = round2(amount);
  const lines: AllocationLine[] = [];
  for (const doc of docs) {
    if (left <= 0) break;
    const due = round2(doc.dueAmount);
    if (due <= 0) continue;
    const applied = Math.min(due, left);
    left = round2(left - applied);
    const paidAmount = round2(doc.paidAmount + applied);
    const dueAmount = round2(due - applied);
    lines.push({ id: doc._id, applied, paidAmount, dueAmount, status: statusFor(paidAmount, dueAmount) });
  }
  return { lines, unapplied: left };
};

/** Apply `amount` to a party's open sales or purchases, oldest first, inside `session`. */
export const allocateToOpenInvoices = async (
  model: Model<any>,
  filter: Record<string, unknown>,
  amount: number,
  session: ClientSession,
) => {
  const open = await model
    .find({ ...filter, dueAmount: { $gt: 0 }, status: { $ne: 'cancelled' } })
    .sort({ date: 1, createdAt: 1 })
    .select('_id total paidAmount dueAmount')
    .session(session)
    .lean<OpenDoc[]>();
  const plan = planAllocation(open, amount);
  for (const line of plan.lines) {
    await model.updateOne(
      { _id: line.id },
      { $set: { paidAmount: line.paidAmount, dueAmount: line.dueAmount, status: line.status } },
      { session },
    );
  }
  return plan;
};
