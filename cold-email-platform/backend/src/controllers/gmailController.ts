import { RequestHandler } from 'express';
import { google } from 'googleapis';
import { User } from '../models/User';
import { AuthRequest } from '../middleware/auth';
import { encryptToken, decryptToken } from '../utils/crypto';
import { createOAuthState, verifyOAuthState } from '../utils/oauthState';
import { createOAuthClient, gmailSendScope } from '../services/gmail';
import { env } from '../config/env';
import { logger } from '../config/logger';

type OAuthErrorReason = 'access_denied' | 'no_refresh_token' | 'invalid_state' | 'exchange_failed' | 'missing_send_permission';

function redirectOAuthError(res: Parameters<RequestHandler>[1], reason: OAuthErrorReason) {
  res.redirect(`${env.frontendUrl}/settings?gmail=error&reason=${reason}`);
}

function normalizeScopes(scopes: string | string[] | null | undefined): Set<string> {
  const values = Array.isArray(scopes) ? scopes : [scopes ?? ''];
  return new Set(values.flatMap(value => value.split(' ')).map(scope => scope.trim()).filter(Boolean));
}

export const authUrl: RequestHandler = async (req, res, next) => {
  try {
    const user = (req as AuthRequest).user!;
    const oauth = createOAuthClient();
    const url = oauth.generateAuthUrl({
      access_type: 'offline', prompt: 'consent',
      scope: ['openid', 'email', gmailSendScope], state: createOAuthState(user.id), include_granted_scopes: true
    });
    res.json({ url });
  } catch (error) { next(error); }
};

export const callback: RequestHandler = async (req, res, next) => {
  if (req.query.error) {
    redirectOAuthError(res, req.query.error === 'access_denied' ? 'access_denied' : 'exchange_failed');
    return;
  }

  const state = typeof req.query.state === 'string' ? req.query.state : '';
  let userId: string;
  try {
    userId = verifyOAuthState(state);
  } catch {
    redirectOAuthError(res, 'invalid_state');
    return;
  }

  const code = typeof req.query.code === 'string' ? req.query.code : '';
  if (!code) {
    redirectOAuthError(res, 'exchange_failed');
    return;
  }

  try {
    const oauth = createOAuthClient();
    const { tokens } = await oauth.getToken(code);
    if (!tokens.access_token) {
      redirectOAuthError(res, 'exchange_failed');
      return;
    }

    let grantedScopes = normalizeScopes(tokens.scope);
    if (!grantedScopes.has(gmailSendScope)) {
      try {
        const tokenInfo = await oauth.getTokenInfo(tokens.access_token);
        grantedScopes = normalizeScopes(tokenInfo.scopes);
      } catch {
        logger.info({ grantedScopes: [...grantedScopes] }, 'Gmail OAuth scopes reported by token response');
        logger.error('Unable to verify Gmail OAuth scopes using token info');
        redirectOAuthError(res, 'exchange_failed');
        return;
      }
    }
    logger.info({ grantedScopes: [...grantedScopes] }, 'Gmail OAuth scopes granted');

    if (!grantedScopes.has(gmailSendScope)) {
      try {
        await oauth.revokeToken(tokens.access_token);
      } catch {
        logger.warn('Unable to revoke Gmail OAuth token after missing send permission');
      }
      redirectOAuthError(res, 'missing_send_permission');
      return;
    }

    if (!tokens.refresh_token) {
      redirectOAuthError(res, 'no_refresh_token');
      return;
    }

    oauth.setCredentials(tokens);
    const user = await User.findById(userId).select('+gmail.accessToken +gmail.refreshToken');
    if (!user) {
      redirectOAuthError(res, 'exchange_failed');
      return;
    }
    const profile = await google.oauth2({ version: 'v2', auth: oauth }).userinfo.get();
    user.gmail = {
      email: profile.data.email ?? undefined, accessToken: encryptToken(tokens.access_token),
      refreshToken: encryptToken(tokens.refresh_token), expiryDate: tokens.expiry_date ?? undefined,
      connectedAt: new Date()
    };
    await user.save();
    res.redirect(`${env.frontendUrl}/settings?gmail=connected`);
  } catch {
    logger.error('Gmail OAuth callback failed during token exchange or account setup');
    redirectOAuthError(res, 'exchange_failed');
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
