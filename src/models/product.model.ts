// models/product.model.ts
import mongoose, { Document } from 'mongoose';

export interface IProduct extends Document {
  business: mongoose.Types.ObjectId;
  name: string;
  sku?: string;
  category?: string;
  purchasePrice: number;
  sellingPrice: number;
  stock: number;
  minStock: number;
  unit: string;
  imageUrl?: string;

  status: boolean;
  createdBy: mongoose.Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const productSchema = new mongoose.Schema<IProduct>(
  {
    business: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Business',
      required: true,
    },
    name: { type: String, required: true, trim: true },
    sku: { type: String, trim: true },
    category: { type: String, trim: true },
    purchasePrice: { type: Number, default: 0, min: 0 },
    sellingPrice: { type: Number, default: 0, min: 0 },
    stock: { type: Number, default: 0, min: 0 },
    minStock: { type: Number, default: 0, min: 0 },
    unit: { type: String, default: 'pcs', trim: true },
    imageUrl: { type: String, trim: true },

    status: { type: Boolean, default: true },
    createdBy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
  },
  { timestamps: true, versionKey: false },
);

productSchema.index({ business: 1, status: 1 });
productSchema.index({ business: 1, name: 1 });
productSchema.index({ business: 1, sku: 1 });

const Product = mongoose.model<IProduct>('Product', productSchema);
export default Product;
