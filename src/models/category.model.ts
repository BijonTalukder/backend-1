import mongoose, { Document, Types } from 'mongoose';

export interface ICategory extends Document {
  name: string;
  business?: Types.ObjectId | null;
  status: boolean;
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new mongoose.Schema<ICategory>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      unique: false,
    },
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      default: null,
    },
    status: {
      type: Boolean,
      default: true,
    },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  {
    timestamps: true,
    versionKey: false,
  },
);

categorySchema.index({ name: 1, createdBy: 1 });
categorySchema.index({ business: 1, status: 1 });
categorySchema.index({ business: 1, name: 1 });

const Category = mongoose.model<ICategory>('Category', categorySchema);

export default Category;
