import jwt from 'jsonwebtoken';
import { env } from '../config/env';

export function createOAuthState(userId: string) {
  return jwt.sign({ purpose: 'gmail-oauth', sub: userId }, env.oauthStateSecret, { expiresIn: '10m' });
}

export function verifyOAuthState(state: string) {
  const payload = jwt.verify(state, env.oauthStateSecret) as { purpose?: string; sub?: string };
  if (payload.purpose !== 'gmail-oauth' || !payload.sub) throw new Error('Invalid OAuth state');
  return payload.sub;
}
