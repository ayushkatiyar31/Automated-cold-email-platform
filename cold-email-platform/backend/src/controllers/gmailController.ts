import { RequestHandler } from 'express';
import { google } from 'googleapis';
import { User } from '../models/User';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../utils/errors';
import { encryptToken, decryptToken } from '../utils/crypto';
import { createOAuthState, verifyOAuthState } from '../utils/oauthState';
import { createOAuthClient, gmailScopes, gmailSendScope } from '../services/gmail';
import { env } from '../config/env';

export const authUrl: RequestHandler = async (req, res, next) => {
  try {
    const user = (req as AuthRequest).user!;
    const oauth = createOAuthClient();
    const url = oauth.generateAuthUrl({
      access_type: 'offline', prompt: 'consent',
      scope: gmailScopes, state: createOAuthState(user.id), include_granted_scopes: true
    });
    res.json({ url });
  } catch (error) { next(error); }
};

export const callback: RequestHandler = async (req, res, next) => {
  try {
    if (req.query.error) {
      res.redirect(`${env.frontendUrl}/settings?gmail=error&reason=${encodeURIComponent(String(req.query.error_description ?? req.query.error))}`);
      return;
    }
    const state = typeof req.query.state === 'string' ? req.query.state : '';
    const code = typeof req.query.code === 'string' ? req.query.code : '';
    const userId = verifyOAuthState(state);
    if (!code) throw new AppError(400, 'Missing OAuth authorization code', 'INVALID_OAUTH_RESPONSE');
    const oauth = createOAuthClient();
    const { tokens } = await oauth.getToken(code);
    oauth.setCredentials(tokens);
    const tokenInfo = await google.oauth2({ version: 'v2', auth: oauth }).tokeninfo();
    const granted = String(tokenInfo.data.scope ?? '').split(/\s+/);
    if (!granted.includes(gmailSendScope)) {
      throw new AppError(403, 'Gmail send permission was not granted. Please enable the gmail.send scope.', 'GMAIL_SEND_SCOPE_REQUIRED');
    }
    if (!tokens.access_token || !tokens.refresh_token) throw new AppError(400, 'Google did not provide the required refresh token. Revoke access and connect again.', 'OAUTH_TOKENS_REQUIRED');
    const user = await User.findById(userId).select('+gmail.accessToken +gmail.refreshToken');
    if (!user) throw new AppError(404, 'User not found', 'NOT_FOUND');
    const profile = await google.oauth2({ version: 'v2', auth: oauth }).userinfo.get();
    user.gmail = {
      email: profile.data.email ?? undefined, accessToken: encryptToken(tokens.access_token),
      refreshToken: encryptToken(tokens.refresh_token), expiryDate: tokens.expiry_date ?? undefined,
      connectedAt: new Date()
    };
    await user.save();
    res.redirect(`${env.frontendUrl}/settings?gmail=connected`);
  } catch (error: any) {
    if (env.frontendUrl) {
      const reason = error instanceof AppError ? error.message : (error?.message ?? 'OAuth callback failed');
      res.redirect(`${env.frontendUrl}/settings?gmail=error&reason=${encodeURIComponent(reason)}`);
      return;
    }
    next(error);
  }
};

export const status: RequestHandler = async (req, res, next) => {
  try {
    const user = await User.findById((req as AuthRequest).user!.id).select('+gmail.accessToken +gmail.refreshToken');
    res.json({ gmail: { connected: !!user?.gmail?.refreshToken && !!user.gmail.accessToken, email: user?.gmail?.email ?? null, connectedAt: user?.gmail?.connectedAt ?? null } });
  } catch (error) { next(error); }
};

export const disconnect: RequestHandler = async (req, res, next) => {
  try {
    const user = await User.findById((req as AuthRequest).user!.id).select('+gmail.accessToken +gmail.refreshToken');
    if (!user?.gmail) { res.status(204).send(); return; }
    const token = user.gmail.refreshToken ? decryptToken(user.gmail.refreshToken) : undefined;
    if (token) {
      try { await createOAuthClient().revokeToken(token); } catch { /* connection is cleared regardless of provider availability */ }
    }
    user.gmail = undefined;
    await user.save();
    res.status(204).send();
  } catch (error) { next(error); }
};
