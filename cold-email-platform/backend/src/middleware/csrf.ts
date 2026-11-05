import { RequestHandler } from 'express';
import { AppError } from '../utils/errors';
export const csrfProtection: RequestHandler = (req, _res, next) => {
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) return next();
  if (req.get('X-Requested-With') !== 'XMLHttpRequest') return next(new AppError(403, 'Missing X-Requested-With header', 'CSRF_BLOCKED'));
  next();
};
