import dotenv from 'dotenv';
import { existsSync } from 'fs';
import { resolve } from 'path';

const backendEnvPath = resolve(__dirname, '../../.env');
const projectEnvPath = resolve(__dirname, '../../../.env');
const localEnvPath = resolve(__dirname, '../../.env.local');

for (const envPath of [backendEnvPath, projectEnvPath, localEnvPath]) {
  if (existsSync(envPath)) {
    const parsed = dotenv.config({ path: envPath, override: false });
    if (parsed.error) {
      console.warn(`Unable to load .env from ${envPath}: ${parsed.error.message}`);
    }
  }
}

const readEnv = (key: string, fallback?: string) => {
  const value = process.env[key]?.trim() ?? fallback?.trim();
  if (!value) {
    if (fallback === undefined) {
      throw new Error(`Missing required environment variable: ${key}`);
    }
    return fallback;
  }
  return value;
};

export const validateGoogleOAuthConfig = () => {
  const loaded = !!readEnv('GOOGLE_CLIENT_ID', '').trim();
  console.info(`GOOGLE_CLIENT_ID loaded: ${loaded}`);
  if (!loaded) {
    throw new Error('Missing required GOOGLE_CLIENT_ID environment variable for Gmail OAuth. Set GOOGLE_CLIENT_ID in backend/.env and restart the backend.');
  }
  return loaded;
};

export const env = {
  nodeEnv: readEnv('NODE_ENV', 'development'),
  port: Number(readEnv('PORT', '4000')),
  mongodbUri: readEnv('MONGODB_URI', 'mongodb://127.0.0.1:27017/cold_email'),
  redisUrl: readEnv('REDIS_URL', 'redis://127.0.0.1:6379'),
  frontendUrl: readEnv('FRONTEND_URL', 'http://localhost:3000').split(',').map(value => value.trim())[0],
  frontendUrls: readEnv('FRONTEND_URL', 'http://localhost:3000').split(',').map(value => value.trim()).filter(Boolean),
  jwtAccessSecret: readEnv('JWT_ACCESS_SECRET'),
  jwtRefreshSecret: readEnv('JWT_REFRESH_SECRET'),
  accessExpires: readEnv('JWT_ACCESS_EXPIRES', '15m'),
  refreshExpires: readEnv('JWT_REFRESH_EXPIRES', '7d'),
  encryptionKey: readEnv('TOKEN_ENCRYPTION_KEY'),
  oauthStateSecret: readEnv('OAUTH_STATE_SECRET'),
  googleClientId: readEnv('GOOGLE_CLIENT_ID', ''),
  googleClientSecret: readEnv('GOOGLE_CLIENT_SECRET', ''),
  googleRedirectUri: readEnv('GOOGLE_REDIRECT_URI', 'http://localhost:4000/api/gmail/callback'),
  runWorker: readEnv('RUN_WORKER', 'false').toLowerCase() === 'true',
  maxUploadBytes: Number(readEnv('MAX_UPLOAD_BYTES', '10485760'))
};
