import { RequestHandler } from 'express';
import { User, IUser } from '../models/User';
import { verifyAccess } from '../utils/tokens';
import { AppError } from '../utils/errors';
export interface AuthRequest extends Express.Request { user?: IUser; }
export const requireAuth: RequestHandler = async (req, _res, next) => {
  try {
    const token = req.cookies?.access_token;
    if (!token) throw new AppError(401, 'Authentication required', 'UNAUTHENTICATED');
    const payload = verifyAccess(token);
    const user = await User.findById(payload.sub);
    if (!user) throw new AppError(401, 'User no longer exists', 'UNAUTHENTICATED');
    (req as AuthRequest).user = user;
    next();
  } catch (error) { next(error instanceof AppError ? error : new AppError(401, 'Invalid or expired access token', 'UNAUTHENTICATED')); }
};
