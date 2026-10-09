// src/__tests__/multiTenantSecurity.test.ts
import { describe, it } from 'node:test';
import assert from 'node:assert';
import { Types } from 'mongoose';
import { getValidIds, requireMembership } from '../utils/businessAuth';
import ApiError from '../Error/handleApiError';
import { executeQuery } from '../services/queryExecutor.service';
import { BusinessMembersModel } from '../models/business-members.model';

describe('Critical Multi-Tenant Security & Access Control', () => {
  it('should reject requests with invalid user or business ObjectIds', () => {
    assert.throws(
      () => getValidIds('not-a-valid-id'),
      (err: any) => err instanceof ApiError && err.statusCode === 400,
    );

    const validUser = new Types.ObjectId().toString();
    assert.throws(
      () => getValidIds(validUser, 'malicious-business-id-999'),
      (err: any) => err instanceof ApiError && err.statusCode === 400,
    );
  });

  it('should correctly cast valid strings to Types.ObjectId', () => {
    const validUser = new Types.ObjectId();
    const validBusiness = new Types.ObjectId();

    const ids = getValidIds(validUser.toString(), validBusiness.toString());
    assert.ok(ids.objectUserId instanceof Types.ObjectId);
    assert.ok(ids.objectBusinessId instanceof Types.ObjectId);
    assert.strictEqual(ids.objectUserId.toString(), validUser.toString());
    assert.strictEqual(ids.objectBusinessId.toString(), validBusiness.toString());
  });

  it('should reject unauthorized tenant access when membership is missing', async () => {
    const foreignBusinessId = new Types.ObjectId();
    const attackerUserId = new Types.ObjectId();

    // Mock BusinessMembersModel.findOne to simulate missing membership
    const origFindOne = BusinessMembersModel.findOne;
    (BusinessMembersModel as any).findOne = () => Promise.resolve(null);

    try {
      await assert.rejects(
        async () => {
          await requireMembership(foreignBusinessId, attackerUserId);
        },
        (err: any) => err instanceof ApiError && err.statusCode === 403,
      );
    } finally {
      (BusinessMembersModel as any).findOne = origFindOne;
    }
  });

  it('should block executeQuery immediately if membership authorization fails', async () => {
    const foreignBusinessId = new Types.ObjectId();
    const attackerUserId = new Types.ObjectId();

    const origFindOne = BusinessMembersModel.findOne;
    (BusinessMembersModel as any).findOne = () => Promise.resolve(null);

    try {
      await assert.rejects(
        async () => {
          await executeQuery(
            { op: 'sales', command: '/sales' },
            { businessId: foreignBusinessId, userId: attackerUserId },
          );
        },
        (err: any) => err instanceof ApiError && err.statusCode === 403,
      );
    } finally {
      (BusinessMembersModel as any).findOne = origFindOne;
    }
  });
});
