// types/index.d.ts
import { Types } from 'mongoose';

export interface IUserPayload {
  _id: Types.ObjectId | string;
  id: string;
  email: string;
  role: 'owner' | 'admin' | 'member' | 'user';
}

declare global {
  namespace Express {
    export interface Request {
      user?: IUserPayload;
    }
  }
}

// export {};
