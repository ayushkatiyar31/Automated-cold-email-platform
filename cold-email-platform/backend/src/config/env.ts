import dotenv from 'dotenv';
import { resolve } from 'path';
dotenv.config({ path: resolve(__dirname, '../../../.env') });
dotenv.config({ path: resolve(__dirname, '../../.env') });

const required = (key: string, fallback?: string) => {
  const value = process.env[key] ?? fallback;
  if (!value) throw new Error(`Missing required environment variable: ${key}`);
  return value;
};

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 4000),
  mongodbUri: required('MONGODB_URI', 'mongodb://127.0.0.1:27017/cold_email'),
  redisUrl: required('REDIS_URL', 'redis://127.0.0.1:6379'),
  frontendUrl: required('FRONTEND_URL', 'http://localhost:3000').split(',').map(value => value.trim())[0],
  frontendUrls: required('FRONTEND_URL', 'http://localhost:3000').split(',').map(value => value.trim()).filter(Boolean),
  jwtAccessSecret: required('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: required('JWT_REFRESH_SECRET'),
  accessExpires: process.env.JWT_ACCESS_EXPIRES ?? '15m',
  refreshExpires: process.env.JWT_REFRESH_EXPIRES ?? '7d',
  encryptionKey: required('TOKEN_ENCRYPTION_KEY'),
  oauthStateSecret: required('OAUTH_STATE_SECRET'),
  googleClientId: process.env.GOOGLE_CLIENT_ID ?? '',
  googleClientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
  googleRedirectUri: process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:4000/api/auth/google/callback',
  maxUploadBytes: Number(process.env.MAX_UPLOAD_BYTES ?? 10485760)
};
