// utils/cost.ts
import { round2 } from './money';

/**
 * Moving-average cost after a purchase: the stock already on hand at its
 * current cost, plus the new units at their (discounted) price. With no
 * usable stock on hand the new price simply becomes the cost.
 */
export const weightedAverageCost = (
  stockBefore: number,
  costBefore: number,
  quantity: number,
  unitPrice: number,
): number => {
  const onHand = Math.max(0, stockBefore);
  if (onHand === 0 || costBefore <= 0) return round2(unitPrice);
  return round2((onHand * costBefore + quantity * unitPrice) / (onHand + quantity));
};
