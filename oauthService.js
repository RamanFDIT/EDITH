import crypto from 'crypto';
import fetch from 'node-fetch';
import { User } from './db.js';

/**
 * oauthService.js — Refactored for Web (Server-Side)
 */

function getOAuthProviders() {
  const baseUrl = process.env.APP_URL || 'http://localhost:3000';
  if (!process.env.APP_URL) {
    console.warn(`[OAuth] APP_URL not set. Defaulting to ${baseUrl}. Redirects may fail in production.`);
  }
  const callbackUrl = `${baseUrl}/api/oauth/callback`;

  return {
    google: {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      clientId: process.env.OAUTH_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.OAUTH_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '',
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.compose',
        'https://www.googleapis.com/auth/generative-language',
      ],
      redirectUri: callbackUrl,
      extraParams: { access_type: 'offline', prompt: 'consent' },
    },
    github: {
      authUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      clientId: process.env.OAUTH_GITHUB_CLIENT_ID || '',
      clientSecret: process.env.OAUTH_GITHUB_CLIENT_SECRET || '',
      scopes: ['repo', 'read:user', 'read:org'],
      redirectUri: callbackUrl,
      extraParams: {},
    },
    slack: {
      authUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      clientId: process.env.OAUTH_SLACK_CLIENT_ID || '',
      clientSecret: process.env.OAUTH_SLACK_CLIENT_SECRET || '',
      scopes: ['chat:write', 'channels:read', 'channels:join', 'chat:write.customize'],
      redirectUri: callbackUrl,
      extraParams: {},
    },
    figma: {
      authUrl: 'https://www.figma.com/oauth',
      tokenUrl: 'https://api.figma.com/v1/oauth/token',
      clientId: process.env.OAUTH_FIGMA_CLIENT_ID || '',
      clientSecret: process.env.OAUTH_FIGMA_CLIENT_SECRET || '',
      scopes: ['file_content:read', 'file_comments:read', 'file_comments:write'],
      redirectUri: callbackUrl,
      extraParams: { response_type: 'code' },
    },
    jira: {
      authUrl: 'https://auth.atlassian.com/authorize',
      tokenUrl: 'https://auth.atlassian.com/oauth/token',
      clientId: process.env.OAUTH_JIRA_CLIENT_ID || '',
      clientSecret: process.env.OAUTH_JIRA_CLIENT_SECRET || '',
      scopes: [
        'read:jira-work', 'write:jira-work', 'read:jira-user',
        'manage:jira-project', 'manage:jira-configuration',
        'offline_access'
      ],
      redirectUri: callbackUrl,
      extraParams: { audience: 'api.atlassian.com', prompt: 'consent' },
    },
  };
}

export async function getStoredTokens(userId, provider) {
  const user = await User.findById(userId);
  if (!user || !user.tokens || !user.tokens[provider]) return null;
  return user.tokens[provider];
}

export function isTokenExpired(tokens) {
  if (!tokens || !tokens.expires_at) return true;
  return Date.now() > (new Date(tokens.expires_at).getTime() - 5 * 60 * 1000);
}

export async function storeTokens(userId, provider, tokenData) {
  const expiresAt = tokenData.expires_in
    ? new Date(Date.now() + tokenData.expires_in * 1000)
    : (provider === 'slack' ? new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000) : null);

  const update = {
    [`tokens.${provider}.access_token`]: tokenData.access_token,
    [`tokens.${provider}.token_type`]: tokenData.token_type || 'Bearer',
    [`tokens.${provider}.scope`]: tokenData.scope || '',
    [`tokens.${provider}.expires_at`]: expiresAt,
  };

  if (tokenData.refresh_token) {
    update[`tokens.${provider}.refresh_token`] = tokenData.refresh_token;
  }

  if (tokenData.cloud_id) update[`tokens.${provider}.cloud_id`] = tokenData.cloud_id;
  if (tokenData.cloud_url) update[`tokens.${provider}.cloud_url`] = tokenData.cloud_url;

  await User.findByIdAndUpdate(userId, { $set: update }, { upsert: true });
  console.log(`[OAuth] Stored tokens for user ${userId}, provider ${provider}`);
}

export async function clearTokens(userId, provider) {
  await User.findByIdAndUpdate(userId, { $unset: { [`tokens.${provider}`]: "" } });
  console.log(`[OAuth] Cleared tokens for user ${userId}, provider ${provider}`);
}

export async function getConnectionStatus(userId) {
  const user = await User.findById(userId);
  const status = {};
  const providers = getOAuthProviders();
  
  for (const provider of Object.keys(providers)) {
    const tokens = user?.tokens?.[provider];
    status[provider] = {
      connected: !!tokens?.access_token,
      expired: tokens ? isTokenExpired(tokens) : true,
      hasRefreshToken: !!tokens?.refresh_token,
    };
  }
  return status;
}

export async function refreshAccessToken(userId, provider) {
  const config = getOAuthProviders()[provider];
  const tokens = await getStoredTokens(userId, provider);

  if (!tokens?.refresh_token) throw new Error(`No refresh token for ${provider}`);

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refresh_token,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: body.toString(),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`Refresh failed: ${JSON.stringify(data)}`);

  await storeTokens(userId, provider, data);
  return data.access_token;
}

export async function getValidToken(userId, provider) {
  const tokens = await getStoredTokens(userId, provider);
  if (!tokens) return null;

  if (isTokenExpired(tokens) && tokens.refresh_token) {
    try {
      return await refreshAccessToken(userId, provider);
    } catch (err) {
      console.error(`[OAuth] Auto-refresh failed for ${provider}:`, err.message);
      return null;
    }
  }
  return tokens.access_token;
}

export function buildAuthUrl(provider, state) {
  const config = getOAuthProviders()[provider];
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    state: state,
    ...config.extraParams,
  });

  if (provider === 'slack') {
    params.set('scope', config.scopes.join(','));
  } else {
    params.set('scope', config.scopes.join(' '));
  }

  return `${config.authUrl}?${params.toString()}`;
}

export async function exchangeCodeForTokens(provider, code) {
  const config = getOAuthProviders()[provider];
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: code,
    redirect_uri: config.redirectUri,
    client_id: config.clientId,
    client_secret: config.clientSecret,
  });

  const response = await fetch(config.tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Accept': 'application/json' },
    body: body.toString(),
  });

  const data = await response.json();
  if (!response.ok) throw new Error(`Exchange failed: ${JSON.stringify(data)}`);
  
  if (provider === 'slack' && !data.ok) throw new Error(`Slack error: ${data.error}`);
  
  return data;
}

export async function discoverJiraCloudId(accessToken) {
  const response = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
  });
  const sites = await response.json();
  if (sites.length === 0) throw new Error('No Jira sites found');
  return { cloud_id: sites[0].id, cloud_url: sites[0].url };
}
