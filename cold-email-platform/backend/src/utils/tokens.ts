import jwt, { SignOptions } from 'jsonwebtoken';
import crypto from 'crypto';
import { env } from '../config/env';
export const accessToken = (userId: string) => jwt.sign({ sub: userId }, env.jwtAccessSecret, { expiresIn: env.accessExpires } as SignOptions);
export const refreshToken = (userId: string, rememberMe = false) => jwt.sign({ sub: userId, nonce: crypto.randomBytes(16).toString('hex'), rememberMe }, env.jwtRefreshSecret, { expiresIn: rememberMe ? '30d' : env.refreshExpires } as SignOptions);
export const verifyAccess = (token: string) => jwt.verify(token, env.jwtAccessSecret) as { sub: string };
export const verifyRefresh = (token: string) => jwt.verify(token, env.jwtRefreshSecret) as { sub: string; rememberMe?: boolean };
export const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');
