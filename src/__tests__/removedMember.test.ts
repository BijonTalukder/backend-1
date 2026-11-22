// A member removed from a business (status:false) must lose access at once.
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Types } from 'mongoose';
import { requireMembership } from '../utils/businessAuth';
import ApiError from '../Error/handleApiError';
import { BusinessMembersModel } from '../models/business-members.model';

type Row = { business: Types.ObjectId; user: Types.ObjectId; role: string; status: boolean };

/** findOne over an in-memory table, matching the filter the way MongoDB would. */
const fakeFindOne = (rows: Row[]) => (filter: Record<string, unknown>) => {
  const matches = (row: Row) =>
    Object.entries(filter).every(([key, want]) => {
      const have = row[key as keyof Row];
      if (want && typeof want === 'object' && '$in' in want) return (want.$in as unknown[]).includes(have);
      if (want instanceof Types.ObjectId) return want.equals(have as Types.ObjectId);
      return have === want;
    });
  return Promise.resolve(rows.find(matches) ?? null);
};

const withMembers = async (rows: Row[], fn: () => Promise<void>) => {
  const original = BusinessMembersModel.findOne;
  (BusinessMembersModel as unknown as { findOne: unknown }).findOne = fakeFindOne(rows);
  try {
    await fn();
  } finally {
    (BusinessMembersModel as unknown as { findOne: unknown }).findOne = original;
  }
};

describe('removed members lose access', () => {
  const business = new Types.ObjectId();
  const removedAdmin = new Types.ObjectId();
  const activeMember = new Types.ObjectId();
  const rows: Row[] = [
    { business, user: removedAdmin, role: 'admin', status: false },
    { business, user: activeMember, role: 'member', status: true },
  ];

  it('rejects a removed admin, for reads and for owner/admin actions', async () => {
    await withMembers(rows, async () => {
      for (const roles of [undefined, ['owner', 'admin']]) {
        await assert.rejects(
          () => requireMembership(business, removedAdmin, roles),
          (err: unknown) => err instanceof ApiError && err.statusCode === 403,
        );
      }
    });
  });

  it('still lets an active member in', async () => {
    await withMembers(rows, async () => {
      const membership = await requireMembership(business, activeMember);
      assert.equal(membership.role, 'member');
    });
  });
});
