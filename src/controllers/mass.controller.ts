import { Request, Response } from 'express';
import { startOfMonth, endOfMonth } from 'date-fns';
import mongoose from 'mongoose';
import { BusinessMembersModel } from '../models/business-members.model';
import Transaction from '../models/transaction.model';


/*
  GET /api/mess/summary?businessId=&year=&month=

  Logic:
  ─────
  1. Fetch all EXPENSE transactions for the month
  2. Sum total expenses
  3. Divide equally among all active members → per-person share
  4. Sum what each member actually PAID (their expense entries)
  5. balance = paid - share
     +ve → they are OWED money (others should pay them)
     -ve → they OWE money (they need to pay others)

  Returns per-member breakdown + who owes whom
*/
const getMessSummary = async (req: Request, res: Response) => {
    try {
        const { businessId, year, month } = req.query as Record<string, string>;
        const userId = String((req as any).user._id);

        if (!businessId) return res.status(400).json({ message: 'businessId required' });

        // Check access
        const myMembership = await BusinessMembersModel.findOne({
            user: userId, business: businessId, isActive: true,
        });
        if (!myMembership) return res.status(403).json({ message: 'Access denied' });

        const y = year ? parseInt(year) : new Date().getFullYear();
        const m = month ? parseInt(month) : new Date().getMonth(); // 0-based

        const from = startOfMonth(new Date(y, m, 1));
        const to = endOfMonth(new Date(y, m, 1));

        // All active members
        const members = await BusinessMembersModel.find({
            business: businessId, isActive: true,
        }).populate('user', 'firstName lastName email').lean();

        const memberCount = members.length;
        if (memberCount === 0) return res.json({ data: { members: [], totalExpense: 0, perPersonShare: 0, settlements: [] } });

        // All EXPENSE transactions for the month
        const expenses = await Transaction.find({
            business: businessId,
            type: 'expense',
            date: { $gte: from, $lte: to },
        }).populate('member', 'firstName lastName').lean();

        // All INCOME transactions for the month (e.g. someone deposited to mess fund)
        const incomes = await Transaction.find({
            business: businessId,
            type: 'income',
            date: { $gte: from, $lte: to },
        }).populate('member', 'firstName lastName').lean();

        // Total expenses for the month
        const totalExpense = expenses.reduce((s, t) => s + t.amount, 0);
        const totalIncome = incomes.reduce((s, t) => s + t.amount, 0);

        // Per-person equal share
        const perPersonShare = totalExpense / memberCount;

        // Build per-member paid amounts
        const memberMap: Record<string, {
            memberId: string;
            name: string;
            email: string;
            totalPaid: number;   // expense transactions they made
            totalDeposited: number; // income transactions (mess fund deposits)
            share: number;   // their equal share of total expenses
            balance: number;   // totalPaid - share (+ve = owed, -ve = owes)
            expenses: { category: string; amount: number; date: string; note?: string }[];
        }> = {};

        for (const bm of members) {
            const u = bm.user as any;
            memberMap[String(u._id)] = {
                memberId: String(u._id),
                name: `${u.firstName} ${u.lastName}`,
                email: u.email,
                totalPaid: 0,
                totalDeposited: 0,
                share: perPersonShare,
                balance: 0,
                expenses: [],
            };
        }

        // Accumulate expenses per member
        for (const txn of expenses) {
            const mid = String((txn.member as any)?._id ?? txn.member);
            if (memberMap[mid]) {
                memberMap[mid].totalPaid += txn.amount;
                memberMap[mid].expenses.push({
                    category: (txn as any).category?.name ?? 'Uncategorized',
                    amount: txn.amount,
                    date: txn.date.toISOString().slice(0, 10),
                    note: txn.note,
                });
            }
        }

        // Accumulate incomes per member (deposits to mess fund)
        for (const txn of incomes) {
            const mid = String((txn.member as any)?._id ?? txn.member);
            if (memberMap[mid]) {
                memberMap[mid].totalDeposited += txn.amount;
            }
        }

        // Calculate balances
        for (const key of Object.keys(memberMap)) {
            const mm = memberMap[key];
            // balance = what they paid - their share
            mm.balance = mm.totalPaid - mm.share;
        }

        const memberList = Object.values(memberMap);

        /*
          Settlement suggestions:
          ─────────────────────
          Creditors (balance > 0) should RECEIVE from debtors (balance < 0)
          Greedy algorithm to minimize transactions
        */
        const creditors = memberList
            .filter((m) => m.balance > 0.01)
            .map((m) => ({ ...m, remaining: m.balance }))
            .sort((a, b) => b.remaining - a.remaining);

        const debtors = memberList
            .filter((m) => m.balance < -0.01)
            .map((m) => ({ ...m, remaining: Math.abs(m.balance) }))
            .sort((a, b) => b.remaining - a.remaining);

        const settlements: {
            from: string; fromId: string;
            to: string; toId: string;
            amount: number;
        }[] = [];

        let ci = 0, di = 0;
        while (ci < creditors.length && di < debtors.length) {
            const c = creditors[ci];
            const d = debtors[di];
            const amt = Math.min(c.remaining, d.remaining);
            if (amt > 0.01) {
                settlements.push({
                    from: d.name, fromId: d.memberId,
                    to: c.name, toId: c.memberId,
                    amount: Math.round(amt * 100) / 100,
                });
            }
            c.remaining -= amt;
            d.remaining -= amt;
            if (c.remaining < 0.01) ci++;
            if (d.remaining < 0.01) di++;
        }

        return res.json({
            data: {
                period: { year: y, month: m },
                memberCount,
                totalExpense,
                totalIncome,
                perPersonShare: Math.round(perPersonShare * 100) / 100,
                members: memberList.map((m) => ({
                    ...m,
                    share: Math.round(m.share * 100) / 100,
                    balance: Math.round(m.balance * 100) / 100,
                })),
                settlements,   // who pays whom to settle up
            },
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: 'Server error' });
    }
};
export const massController = {
    getMessSummary
}