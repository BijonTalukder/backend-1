import mongoose, { Document, Model } from 'mongoose';
import bcrypt from 'bcryptjs';

const ROLES = [
  'super_admin',
  'admin',
  'accountant',
  'member',
  'viewer',
] as const;
type Role = (typeof ROLES)[number];

// ── Interface ─────────────────────────────────────────────

export interface IUser extends Document {
  firstName: string;
  lastName: string;
  email: string;
  password: string;
  passwordChangedAt?: Date;
  role: Role;
  organization?: mongoose.Types.ObjectId;
  isActive: boolean;
  lastLogin?: Date;
  avatar?: string;
  createdAt: Date;
  updatedAt: Date;

  // virtual
  fullName: string;

  // methods
  comparePassword(candidatePassword: string): Promise<boolean>;
  changedPasswordAfter(jwtIssuedAt: number): boolean;
}

// ── Schema ────────────────────────────────────────────────

const userSchema = new mongoose.Schema<IUser>(
  {
    firstName: {
      type: String,
      required: [true, 'First name is required.'],
      trim: true,
      maxlength: [50, 'First name cannot exceed 50 characters.'],
    },
    lastName: {
      type: String,
      required: [true, 'Last name is required.'],
      trim: true,
      maxlength: [50, 'Last name cannot exceed 50 characters.'],
    },
    email: {
      type: String,
      required: [true, 'Email is required.'],
      unique: true,
      lowercase: true,
      trim: true,
    },
    password: {
      type: String,
      // required: [true, 'Password is required.'],
      minlength: [8, 'Password must be at least 8 characters.'],
      select: false,
    },
    passwordChangedAt: {
      type: Date,
      select: false,
    },
    role: {
      type: String,
      enum: ROLES,
      default: 'member',
    },
    organization: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Organization',
    },
    isActive: {
      type: Boolean,
      default: true,
    },
    lastLogin: Date,
    avatar: String,
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// ── Indexes ───────────────────────────────────────────────

userSchema.index({ email: 1 });
userSchema.index({ organization: 1, role: 1 });

// ── Virtual ───────────────────────────────────────────────

userSchema.virtual('fullName').get(function (this: IUser) {
  return `${this.firstName} ${this.lastName}`;
});

// ── Pre-save: Hash Password ───────────────────────────────

userSchema.pre('save', async function (next) {
  const user = this as IUser;

  if (!user.isModified('password'))
    //  return next();

    user.password = await bcrypt.hash(user.password, 12);

  if (!user.isNew) {
    user.passwordChangedAt = new Date(Date.now() - 1000);
  }

  // next();
});

// ── Instance Methods ──────────────────────────────────────

userSchema.methods.comparePassword = async function (
  this: IUser,
  candidatePassword: string,
): Promise<boolean> {
  return bcrypt.compare(candidatePassword, this.password);
};

userSchema.methods.changedPasswordAfter = function (
  this: IUser,
  jwtIssuedAt: number,
): boolean {
  if (this.passwordChangedAt) {
    const changedTimestamp = Math.floor(
      this.passwordChangedAt.getTime() / 1000,
    );
    return changedTimestamp > jwtIssuedAt;
  }
  return false;
};

// ── Model Export (Prevent OverwriteModelError in dev) ─────

const User: Model<IUser> =
  mongoose.models.User || mongoose.model<IUser>('User', userSchema);

export default User;
