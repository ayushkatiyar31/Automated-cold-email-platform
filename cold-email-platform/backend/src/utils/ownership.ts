import { Types } from 'mongoose';
import { AppError } from './errors';
export function assertOwner(ownerId: unknown, userId: unknown) {
  if (!ownerId || String(ownerId) !== String(userId)) throw new AppError(403, 'Forbidden', 'FORBIDDEN');
}
export function objectId(value: string) { return Types.ObjectId.isValid(value) ? value : (() => { throw new AppError(400, 'Invalid id', 'INVALID_ID'); })(); }
