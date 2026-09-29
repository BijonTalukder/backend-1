import mongoose, { Document, Model } from 'mongoose';

const PURPOSES = ['password_reset'] as const;
type Purpose = (typeof PURPOSES)[number];

// ── Interface ─────────────────────────────────────────────

export interface IPasswordReset extends Document {
  email: string;
  codeHash: string;
  purpose: Purpose;
  attempts: number;
  expiresAt: Date;
  usedAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

// ── Schema ────────────────────────────────────────────────

const passwordResetSchema = new mongoose.Schema<IPasswordReset>(
  {
    email: {
      type: String,
      required: true,
      lowercase: true,
      trim: true,
    },
    // The 6-digit code never travels or rests in plain text.
    codeHash: {
      type: String,
      required: true,
      select: false,
    },
    purpose: {
      type: String,
      enum: PURPOSES,
      default: 'password_reset',
    },
    attempts: {
      type: Number,
      default: 0,
    },
    expiresAt: {
      type: Date,
      required: true,
    },
    usedAt: {
      type: Date,
      default: null,
    },
  },
  {
    timestamps: true,
  },
);

// ── Indexes ───────────────────────────────────────────────

passwordResetSchema.index({ purpose: 1, email: 1, createdAt: -1 });
// Mongo removes expired codes automatically.
passwordResetSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// ── Model Export ──────────────────────────────────────────

const PasswordReset: Model<IPasswordReset> =
  mongoose.models.PasswordReset ||
  mongoose.model<IPasswordReset>('PasswordReset', passwordResetSchema);

export default PasswordReset;
