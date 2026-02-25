import { Request } from 'express';
import { Types } from 'mongoose';

// export interface AuthRequest extends Request {
//     user: {
//         _id: Types.ObjectId;
//         id: string;
//         email: string;
//         role: string;
//     };
// }
// export interface IUserPayload {
//     _id: Types.ObjectId;
//     id: string;
//     email: string;
//     role: 'owner' | 'admin' | 'member' | 'user'; // customize korte paro
// }
// declare global {
//     namespace Express {
//         interface Request {
//             user?: IUserPayload;
//         }
//     }
// }
export { }

declare global {
    namespace Express {
        export interface Request {
            language?: Language;
            user?: IUserPayload;
        }
    }
}
// types/express/index.d.ts
// declare namespace Express {
//     export interface Request {
//         user: {
//             id: number;
//             username: string;
//             email: string;
//         };
//     }
// }