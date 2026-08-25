// models/sync-operation.model.ts
// Idempotency ledger for offline sync. An offline client stamps every queued
// write with a client-generated `operationId`; retrying a request whose response
// was lost finds the claim here and replays the original result instead of
// creating a second sale/payment/stock movement.
import mongoose, { Document } from 'mongoose';

export type SyncEntityType =
  | 'sale'
  | 'customer'
  | 'product'
  | 'payment'
  | 'stock_adjustment';

export interface ISyncOperation extends Document {
  business: mongoose.Types.ObjectId;
  operationId: string;
  entityType: SyncEntityType;
  entity: mongoose.Types.ObjectId;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const syncOperationSchema = new mongoose.Schema<ISyncOperation>(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
    },
    operationId: { type: String, required: true, trim: true },
    entityType: {
      type: String,
      enum: ['sale', 'customer', 'product', 'payment', 'stock_adjustment'],
      required: true,
    },
    // The record the operation produced (or acted on, for stock adjustments) —
    // a replay re-reads it instead of storing a response snapshot.
    entity: { type: mongoose.Schema.Types.ObjectId, required: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, versionKey: false },
);

syncOperationSchema.index({ business: 1, operationId: 1 }, { unique: true });
// A queue that has not drained in 90 days is beyond recovery anyway.
syncOperationSchema.index(
  { createdAt: 1 },
  { expireAfterSeconds: 60 * 60 * 24 * 90 },
);

const SyncOperation = mongoose.model<ISyncOperation>(
  'SyncOperation',
  syncOperationSchema,
);
export default SyncOperation;
