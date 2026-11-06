import { google } from 'googleapis';
import { IUser } from '../models/User';
import { getConnectedOAuthClient } from './gmail';
import { buildMimeMessage, htmlToPlainText } from './mime';

export type SendErrorClass = 'permanent' | 'quota' | 'transient' | 'auth' | 'unknown';
export function classifySendError(error: any): SendErrorClass {
  const status = error?.code ?? error?.response?.status;
  const text = `${error?.message ?? ''} ${JSON.stringify(error?.response?.data ?? '')}`;
  if (/invalid_grant/i.test(text)) return 'auth';
  const reasons = error?.errors?.map((item: any) => item.reason).join(',') ?? error?.response?.data?.error?.errors?.map((item: any) => item.reason).join(',') ?? '';
  if (/invalidAddress|invalidRecipient|recipient.*invalid/i.test(text)) return 'permanent';
  if (status === 429 || /rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded|rate.?limit/i.test(`${text} ${reasons}`)) return 'quota';
  if (/invalid_grant/i.test(text)) return 'auth';
  if (status === 401 || status === 403 && !/rateLimitExceeded|userRateLimitExceeded|dailyLimitExceeded/i.test(`${text} ${reasons}`)) return 'auth';
  if ((typeof status === 'number' && status >= 500) || error?.code === 'ECONNRESET' || error?.code === 'ETIMEDOUT' || error?.code === 'ENOTFOUND') return 'transient';
  return 'unknown';
}

export async function sendOneEmail(user: IUser, to: string, subject: string, htmlBody: string) {
  const client = await getConnectedOAuthClient(user);
  const gmail = google.gmail({ version: 'v1', auth: client });
  const raw = buildMimeMessage(user.name, user.gmail?.email ?? user.email, to, subject, htmlToPlainText(htmlBody), htmlBody);
  try {
    return await gmail.users.messages.send({ userId: 'me', requestBody: { raw } });
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { classification: classifySendError(error) });
  }
}
