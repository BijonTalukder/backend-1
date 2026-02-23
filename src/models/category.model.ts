import mongoose, { Document, Types } from 'mongoose';

export interface ICategory extends Document {
  name: string;
  status: boolean;
  createdBy: Types.ObjectId; // যে user বা admin create করেছে
  createdAt: Date;
  updatedAt: Date;
}

const categorySchema = new mongoose.Schema<ICategory>(
  {
    name: {
      type: String,
      required: true,
      unique: false, // এখন multiple users same name দিতে পারবে
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

// Index করে রাখলে query fast হবে
categorySchema.index({ name: 1, createdBy: 1 });

const Category = mongoose.model<ICategory>('Category', categorySchema);

export default Category;
