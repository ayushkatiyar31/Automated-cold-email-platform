import crypto from 'crypto';
import { env } from '../config/env';

const key = Buffer.from(env.encryptionKey, 'hex');
if (key.length !== 32) throw new Error('TOKEN_ENCRYPTION_KEY must contain 64 hexadecimal characters');

export function encryptToken(value: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64url')}:${cipher.getAuthTag().toString('base64url')}:${encrypted.toString('base64url')}`;
}

export function decryptToken(value: string): string {
  const [version, ivValue, tagValue, encryptedValue] = value.split(':');
  if (version !== 'v1') throw new Error('Unsupported encrypted token format');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(ivValue, 'base64url'));
  decipher.setAuthTag(Buffer.from(tagValue, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(encryptedValue, 'base64url')), decipher.final()]).toString('utf8');
}
