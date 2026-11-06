import { google, gmail_v1 } from 'googleapis';
import { env } from '../config/env';
import { IUser, User } from '../models/User';
import { decryptToken, encryptToken } from '../utils/crypto';
import { AppError } from '../utils/errors';

export const gmailSendScope = 'https://www.googleapis.com/auth/gmail.send';
export const gmailScopes = [gmailSendScope, 'openid', 'email'];

export function createOAuthClient() {
  return new google.auth.OAuth2(env.googleClientId, env.googleClientSecret, env.googleRedirectUri);
}

export async function refreshGmailTokens(user: IUser) {
  const stored = await User.findById(user.id).select('+gmail.accessToken +gmail.refreshToken');
  if (!stored?.gmail?.refreshToken) throw new AppError(401, 'Gmail reconnect required', 'GMAIL_RECONNECT_REQUIRED');
  const oauth = createOAuthClient();
  oauth.setCredentials({ refresh_token: decryptToken(stored.gmail.refreshToken) });
  try {
    const refreshed = await oauth.refreshAccessToken();
    const credentials = refreshed.credentials;
    stored.gmail.accessToken = encryptToken(credentials.access_token!);
    if (credentials.refresh_token) stored.gmail.refreshToken = encryptToken(credentials.refresh_token);
    stored.gmail.expiryDate = credentials.expiry_date ?? undefined;
    await stored.save();
    oauth.setCredentials(credentials);
  } catch (error: any) {
    if (error?.response?.data?.error === 'invalid_grant') {
      stored.gmail = undefined;
      await stored.save();
      throw new AppError(401, 'Gmail reconnect required', 'GMAIL_RECONNECT_REQUIRED');
    }
    throw error;
  }
  return oauth;
}

export async function getConnectedOAuthClient(user: IUser) {
  const stored = await User.findById(user.id).select('+gmail.accessToken +gmail.refreshToken');
  if (!stored?.gmail?.accessToken || !stored.gmail.refreshToken) throw new AppError(400, 'Gmail is not connected', 'GMAIL_NOT_CONNECTED');
  const oauth = createOAuthClient();
  const credentials: any = {
    access_token: decryptToken(stored.gmail.accessToken),
    refresh_token: decryptToken(stored.gmail.refreshToken),
    expiry_date: stored.gmail.expiryDate
  };
  oauth.setCredentials(credentials);
  if (!stored.gmail.expiryDate || Date.now() > stored.gmail.expiryDate - 60_000) return refreshGmailTokens(user);
  return oauth;
}
