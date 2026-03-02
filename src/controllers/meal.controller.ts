import { Request, Response } from 'express';
import { Meal } from '../models/Meal.model';

import { startOfDay, endOfDay, startOfMonth, endOfMonth } from 'date-fns';
import { BusinessMembersModel } from '../models/business-members.model';

/* ── helpers ───────────────────────────────────── */
const toMidnightUTC = (d: Date) => {
  const n = new Date(d);
  n.setUTCHours(0, 0, 0, 0);
  return n;
};

const getUserRole = async (userId: string, businessId: string) => {
  const bm = await BusinessMembersModel.findOne({
    user: userId,
    business: businessId,
    status: true,
  });
  return bm?.role ?? null;
};

/* ── GET /api/meals?businessId=&year=&month= ────── */
const getMeals = async (req: Request, res: Response) => {
  try {
    const { businessId, year, month } = req.query as Record<string, string>;
    const userId = (req as any).user._id;

    if (!businessId)
      return res.status(400).json({ message: 'businessId required' });

    const role = await getUserRole(userId, businessId);
    if (!role) return res.status(403).json({ message: 'Access denied' });

    const y = year ? parseInt(year) : new Date().getFullYear();
    const m = month ? parseInt(month) : new Date().getMonth(); // 0-based

    const from = startOfMonth(new Date(y, m, 1));
    const to = endOfMonth(new Date(y, m, 1));

    const meals = await Meal.find({
      business: businessId,
      date: { $gte: from, $lte: to },
    })
      .populate('member', 'firstName lastName email')
      .sort({ date: 1, createdAt: 1 });

    // Group by date string → { date, members: [{member, count, mealId}], total }
    const grouped: Record<
      string,
      {
        date: string;
        members: {
          mealId: string;
          member: any;
          count: number;
          note?: string;
        }[];
        total: number;
      }
    > = {};

    meals.forEach((meal) => {
      const key = meal.date.toISOString().slice(0, 10); // YYYY-MM-DD
      if (!grouped[key]) grouped[key] = { date: key, members: [], total: 0 };
      grouped[key].members.push({
        mealId: String(meal._id),
        member: meal.member,
        count: meal.count,
        note: meal.note,
      });
      grouped[key].total += meal.count;
    });

    const summary = {
      totalMeals: meals.reduce((s, m) => s + m.count, 0),
      daysWithMeals: Object.keys(grouped).length,
      year: y,
      month: m,
    };

    return res.json({ data: { days: grouped, summary } });
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err });
  }
};

/* ── POST /api/meals ─── add today's meal ───────── */
const addMeal = async (req: Request, res: Response) => {
  try {
    const { businessId, count, date, memberId, note } = req.body;
    const userId = String((req as any).user._id);

    if (!businessId || count === undefined) {
      return res.status(400).json({ message: 'businessId and count required' });
    }

    const role = await getUserRole(userId, businessId);
    if (!role) return res.status(403).json({ message: 'Access denied' });

    // Non-admin can only add for themselves and only today
    const isAdmin = ['owner', 'admin'].includes(role);

    const targetMemberId = isAdmin && memberId ? memberId : userId;
    const targetDate =
      isAdmin && date
        ? toMidnightUTC(new Date(date))
        : toMidnightUTC(new Date());

    // Regular members can only add today
    if (!isAdmin) {
      const today = toMidnightUTC(new Date());
      if (targetDate.getTime() !== today.getTime()) {
        return res
          .status(403)
          .json({ message: 'You can only add meals for today' });
      }
    }

    const existing = await Meal.findOne({
      business: businessId,
      member: targetMemberId,
      date: targetDate,
    });

    if (existing) {
      // Update existing
      existing.count = Number(count);
      existing.note = note;
      existing.updatedBy = (req as any).user._id;
      await existing.save();
      const populated = await existing.populate(
        'member',
        'firstName lastName email',
      );
      return res.json({ data: populated, message: 'Meal updated' });
    }

    const meal = await Meal.create({
      business: businessId,
      member: targetMemberId,
      date: targetDate,
      count: Number(count),
      note,
      createdBy: userId,
    });

    const populated = await meal.populate('member', 'firstName lastName email');
    return res.status(201).json({ data: populated, message: 'Meal added' });
  } catch (err: any) {
    if (err.code === 11000) {
      return res
        .status(409)
        .json({ message: 'Meal already exists for this date' });
    }
    console.log(err);
    return res.status(500).json({ message: 'Server error', error: err });
  }
};

/* ── PATCH /api/meals/:id ── admin edit ──────────── */
const updateMeal = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const { count, note } = req.body;
    const userId = String((req as any).user._id);

    const meal = await Meal.findById(id);
    if (!meal) return res.status(404).json({ message: 'Meal not found' });

    const role = await getUserRole(userId, String(meal.business));
    if (!role) return res.status(403).json({ message: 'Access denied' });

    const isAdmin = ['owner', 'admin'].includes(role);
    const isOwnerOfMeal = String(meal.member) === userId;

    // Regular member can only edit today's own meal
    if (!isAdmin) {
      if (!isOwnerOfMeal)
        return res.status(403).json({ message: "Cannot edit others' meals" });
      const today = toMidnightUTC(new Date());
      if (meal.date.getTime() !== today.getTime()) {
        return res.status(403).json({ message: "Can only edit today's meal" });
      }
    }

    if (count !== undefined) meal.count = Number(count);
    if (note !== undefined) meal.note = note;
    meal.updatedBy = (req as any).user._id;
    await meal.save();

    const populated = await meal.populate('member', 'firstName lastName email');
    return res.json({ data: populated, message: 'Meal updated' });
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err });
  }
};

/* ── DELETE /api/meals/:id ── admin only ────────── */
const deleteMeal = async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const userId = String((req as any).user._id);

    const meal = await Meal.findById(id);
    if (!meal) return res.status(404).json({ message: 'Meal not found' });

    const role = await getUserRole(userId, String(meal.business));
    const isAdmin = ['owner', 'admin'].includes(role ?? '');

    if (!isAdmin) return res.status(403).json({ message: 'Admin only' });

    await meal.deleteOne();
    return res.json({ message: 'Meal deleted' });
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err });
  }
};

/* ── GET /api/meals/summary ── dashboard widget ── */
const getMealSummary = async (req: Request, res: Response) => {
  try {
    const { businessId } = req.query as Record<string, string>;
    const userId = (req as any).user._id;

    if (!businessId)
      return res.status(400).json({ message: 'businessId required' });

    const role = await getUserRole(userId, businessId);
    console.log(role);
    if (!role) return res.status(403).json({ message: 'Access denied' });

    const now = new Date();
    const from = startOfMonth(now);
    const to = endOfMonth(now);

    const result = await Meal.aggregate([
      {
        $match: {
          business: new (require('mongoose').Types.ObjectId)(businessId),
          date: { $gte: from, $lte: to },
        },
      },
      {
        $group: {
          _id: null,
          total: { $sum: '$count' },
          days: { $addToSet: '$date' },
        },
      },
    ]);

    const total = result[0]?.total ?? 0;
    const days = result[0]?.days?.length ?? 0;

    return res.json({
      data: { total, days, month: now.getMonth(), year: now.getFullYear() },
    });
  } catch (err) {
    return res.status(500).json({ message: 'Server error', error: err });
  }
};
export const mealController = {
  getMeals,
  addMeal,
  updateMeal,
  deleteMeal,
  getMealSummary,
};
