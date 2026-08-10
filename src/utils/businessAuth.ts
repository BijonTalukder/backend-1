// utils/businessAuth.ts
// Shared membership/id-validation helpers for Business Mode controllers.
// Mirrors the pattern already duplicated per-controller (see transaction.controller.ts).
import { Types } from 'mongoose';
import { BusinessMembersModel } from '../models/business-members.model';
import ApiError from '../Error/handleApiError';

export const getValidIds = (userId: unknown, businessId?: string) => {
  if (!userId || !Types.ObjectId.isValid(String(userId))) {
    throw new ApiError(400, 'Invalid user id');
  }
  const ids: { objectUserId: Types.ObjectId; objectBusinessId?: Types.ObjectId } = {
    objectUserId: new Types.ObjectId(String(userId)),
  };
  if (businessId) {
    if (!Types.ObjectId.isValid(businessId)) {
      throw new ApiError(400, 'Invalid business id');
    }
    ids.objectBusinessId = new Types.ObjectId(businessId);
  }
  return ids;
};

export const requireMembership = async (
  businessId: Types.ObjectId,
  userId: Types.ObjectId,
  roles: string[] = ['owner', 'admin', 'member'],
) => {
  const membership = await BusinessMembersModel.findOne({
    business: businessId,
    user: userId,
    role: { $in: roles },
  });
  if (!membership) throw new ApiError(403, 'Access denied');
  return membership;
};
