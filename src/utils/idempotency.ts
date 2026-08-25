// utils/idempotency.ts
// Shared helpers for the offline-sync idempotency contract. Controllers that
// accept queued offline writes call `findReplay` before doing any work and
// `claimOperation` as part of the write, so a retried request can never produce
// a second record. Requests without an `operationId` (normal online traffic)
// bypass the ledger entirely and behave exactly as before.
import { ClientSession, Model, Types } from 'mongoose';
import SyncOperation, { SyncEntityType } from '../models/sync-operation.model';
import ApiError from '../Error/handleApiError';

const OBJECT_ID_RE = /^[0-9a-fA-F]{24}$/;

/**
 * Validate an id the client generated while offline. Offline clients mint
 * ObjectId-shaped ids so records created without a network still reference each
 * other correctly (a sale can point at a customer created moments earlier).
 */
export const parseClientObjectId = (
  value: unknown,
  field: string,
): Types.ObjectId | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || !OBJECT_ID_RE.test(value)) {
    throw new ApiError(400, `Invalid ${field}`);
  }
  return new Types.ObjectId(value);
};

export const parseOperationId = (value: unknown): string | undefined => {
  if (value === undefined || value === null || value === '') return undefined;
  if (typeof value !== 'string' || value.length < 8 || value.length > 100) {
    throw new ApiError(400, 'Invalid operation id');
  }
  return value;
};

/**
 * Resolve a previously processed operation to the record it produced.
 *
 * Returns `null` when the operation is new. A claim whose entity no longer
 * exists is stale (the write failed after the claim landed) — it is dropped so
 * the caller reprocesses the request normally.
 */
export const findReplay = async <T>(
  model: Model<T>,
  business: Types.ObjectId,
  operationId: string | undefined,
): Promise<Types.ObjectId | null> => {
  if (!operationId) return null;

  const claim = await SyncOperation.findOne({ business, operationId });
  if (!claim) return null;

  const exists = await model.exists({ _id: claim.entity });
  if (!exists) {
    await SyncOperation.deleteOne({ _id: claim._id });
    return null;
  }
  return claim.entity;
};

/**
 * Record that `operationId` produced `entity`. Pass the surrounding session
 * where the controller already runs in a transaction so the claim and its side
 * effects commit or roll back together.
 */
export const claimOperation = async (
  input: {
    business: Types.ObjectId;
    operationId: string | undefined;
    entityType: SyncEntityType;
    entity: Types.ObjectId;
    createdBy: Types.ObjectId;
  },
  session?: ClientSession,
) => {
  if (!input.operationId) return;
  await SyncOperation.create(
    [
      {
        business: input.business,
        operationId: input.operationId,
        entityType: input.entityType,
        entity: input.entity,
        createdBy: input.createdBy,
      },
    ],
    { session: session ?? undefined },
  );
};

/** A duplicate claim means a concurrent attempt at the same operation. */
export const isDuplicateOperation = (err: unknown) =>
  (err as { code?: number })?.code === 11000;
