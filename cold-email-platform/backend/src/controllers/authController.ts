import { RequestHandler } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import { z } from 'zod';
import { User } from '../models/User';
import { AppError } from '../utils/errors';
import { accessToken, refreshToken, verifyRefresh, hashToken } from '../utils/tokens';
import { AuthRequest } from '../middleware/auth';

const registerSchema = z.object({ name: z.string().trim().min(2).max(80), email: z.string().trim().email().transform(v => v.toLowerCase()), password: z.string().min(8).max(72), rememberMe: z.boolean().optional().default(false) });
const loginSchema = z.object({ email: z.string().trim().email().transform(v => v.toLowerCase()), password: z.string().min(1).max(72), rememberMe: z.boolean().optional().default(false) });
const profileSchema = z.object({ name: z.string().trim().min(2).max(80).optional(), resumeLink: z.string().url().max(2048).optional().or(z.literal('')) });
const production = process.env.NODE_ENV === 'production';
const cookieBase = {
  httpOnly: true,
  secure: production,
  sameSite: production ? 'none' as const : 'lax' as const,
  path: '/'
};
const setAuthCookies = (res: any, access: string, refresh: string, rememberMe = false) => {
  res.cookie('access_token', access, { ...cookieBase, maxAge: 15 * 60 * 1000 });
  res.cookie('refresh_token', refresh, { ...cookieBase, maxAge: rememberMe ? 30 * 24 * 60 * 60 * 1000 : 7 * 24 * 60 * 60 * 1000 });
};

export const register: RequestHandler = async (req, res, next) => {
  try {
    const input = registerSchema.parse(req.body);
    if (await User.exists({ email: input.email })) throw new AppError(409, 'An account with this email already exists', 'EMAIL_EXISTS');
    const user = await User.create({ ...input, passwordHash: await bcrypt.hash(input.password, 12) });
    const refresh = refreshToken(user.id, input.rememberMe);
    user.refreshTokenHash = hashToken(refresh);
    await user.save();
    setAuthCookies(res, accessToken(user.id), refresh, input.rememberMe);
    res.status(201).json({ user: { id: user.id, name: user.name, email: user.email, resumeLink: user.resumeLink } });
  } catch (error) { next(error); }
};
export const login: RequestHandler = async (req, res, next) => {
  try {
    const input = loginSchema.parse(req.body);
    const user = await User.findOne({ email: input.email }).select('+passwordHash');
    if (!user || !(await user.comparePassword(input.password))) throw new AppError(401, 'Invalid email or password', 'INVALID_CREDENTIALS');
    const refresh = refreshToken(user.id, input.rememberMe);
    user.refreshTokenHash = hashToken(refresh);
    await user.save();
    setAuthCookies(res, accessToken(user.id), refresh, input.rememberMe);
    res.json({ user: { id: user.id, name: user.name, email: user.email, resumeLink: user.resumeLink } });
  } catch (error) { next(error); }
};
export const logout: RequestHandler = async (req, res, next) => {
  try { const user = (req as AuthRequest).user; if (user) { user.refreshTokenHash = undefined; await user.save(); } res.clearCookie('access_token', cookieBase); res.clearCookie('refresh_token', cookieBase); res.status(204).send(); } catch (error) { next(error); }
};
export const refresh: RequestHandler = async (req, res, next) => {
  try {
    const token = req.cookies?.refresh_token; if (!token) throw new AppError(401, 'Refresh token required', 'UNAUTHENTICATED');
    const payload = verifyRefresh(token);
    const user = await User.findById(payload.sub).select('+refreshTokenHash');
    const suppliedHash = hashToken(token);
    const tokenMatches = !!user?.refreshTokenHash && user.refreshTokenHash.length === suppliedHash.length && crypto.timingSafeEqual(Buffer.from(user.refreshTokenHash), Buffer.from(suppliedHash));
    if (!tokenMatches) throw new AppError(401, 'Refresh token revoked', 'UNAUTHENTICATED');
    const nextRefresh = refreshToken(user!.id, Boolean(payload.rememberMe)); user!.refreshTokenHash = hashToken(nextRefresh); await user!.save();
    setAuthCookies(res, accessToken(user.id), nextRefresh, Boolean(payload.rememberMe)); res.json({ user: { id: user.id, name: user.name, email: user.email, resumeLink: user.resumeLink } });
  } catch (error) { next(error); }
};
export const me: RequestHandler = async (req, res) => { const user = (req as AuthRequest).user!; res.json({ user: { id: user.id, name: user.name, email: user.email, resumeLink: user.resumeLink } }); };
export const updateProfile: RequestHandler = async (req, res, next) => {
  try { const input = profileSchema.parse(req.body); const user = (req as AuthRequest).user!; if (input.name !== undefined) user.name = input.name; if (input.resumeLink !== undefined) user.resumeLink = input.resumeLink || undefined; await user.save(); res.json({ user: { id: user.id, name: user.name, email: user.email, resumeLink: user.resumeLink } }); } catch (error) { next(error); }
};
