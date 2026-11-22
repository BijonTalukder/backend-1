// controllers/report.controller.ts
import { Request } from 'express';
import { computeProfitLoss } from '../services/profitLoss.service';
import { resolveDateRange } from '../utils/timezone';
import asyncHandler from '../utils/asyncHandler';
import sendResponse from '../utils/sendResponse';
import ApiError from '../Error/handleApiError';
import { getValidIds, requireMembership } from '../utils/businessAuth';

const getProfitLoss = asyncHandler(async (req: Request, res) => {
  const { objectUserId } = getValidIds(req.user?._id);
  const businessId = req.params.businessId;
  if (!businessId || Array.isArray(businessId)) throw new ApiError(400, 'Invalid business id');
  const { objectBusinessId } = getValidIds(req.user?._id, businessId);

  await requireMembership(objectBusinessId!, objectUserId);

  const { from, to } = req.query as Record<string, string>;
  if (!from || !to) throw new ApiError(400, 'from and to dates are required');

  if (Number.isNaN(new Date(from).getTime()) || Number.isNaN(new Date(to).getTime())) {
    throw new ApiError(400, 'Invalid date range');
  }
  // Whole Dhaka days, start-inclusive / end-exclusive. setHours(23,59,59) on a
  // UTC server cut the range at 05:59 Dhaka time on the last day.
  const { start: fromDate, endExclusive: toDate } = resolveDateRange({ from, to });
  if (fromDate >= toDate) throw new ApiError(400, 'Invalid date range');

  // The comparison period: the same length, immediately before.
  const rangeMs = toDate.getTime() - fromDate.getTime();
  const prevTo = fromDate;
  const prevFrom = new Date(fromDate.getTime() - rangeMs);

  const [current, previous] = await Promise.all([
    computeProfitLoss(objectBusinessId!, fromDate, toDate),
    computeProfitLoss(objectBusinessId!, prevFrom, prevTo),
  ]);

  sendResponse(res, {
    statusCode: 200,
    success: true,
    message: 'Profit & Loss fetched successfully',
    data: {
      range: { from: fromDate, to: toDate },
      previousRange: { from: prevFrom, to: prevTo },
      current,
      previous,
    },
  });
});

export const reportController = {
  getProfitLoss,
};
