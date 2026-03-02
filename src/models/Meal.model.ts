import mongoose, { Document, Schema } from 'mongoose';

export interface IMeal extends Document {
  business: mongoose.Types.ObjectId;
  member: mongoose.Types.ObjectId; // who ate
  date: Date; // normalized to midnight UTC
  count: number; // meal count for that day (1-10)
  note?: string;
  createdBy: mongoose.Types.ObjectId;
  updatedBy?: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const MealSchema = new Schema<IMeal>(
  {
    business: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
    member: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    date: { type: Date, required: true },
    count: { type: Number, required: true, min: 0, max: 30 },
    note: { type: String, trim: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

// Unique per member per day per business
MealSchema.index({ business: 1, member: 1, date: 1 }, { unique: true });
MealSchema.index({ business: 1, date: 1 });

export const Meal = mongoose.model<IMeal>('Meal', MealSchema);
