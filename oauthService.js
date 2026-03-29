import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import fetch from 'node-fetch';
import mongoose from 'mongoose';
import { User } from './db.js';

/**
 * oauthService.js — Refactored for Web (Server-Side)
 */

// --- APP CONFIG MODEL (for persistent settings like ENCRYPTION_KEY) ---
const appConfigSchema = new mongoose.Schema({
  key: { type: String, unique: true, required: true },
  value: { type: String, required: true },
});
const AppConfig = mongoose.models.AppConfig || mongoose.model('AppConfig', appConfigSchema);

// --- ENCRYPTION HELPERS ---
const ALGORITHM = 'aes-256-cbc';

let _cachedKey = null;

/**
 * Must be called after MongoDB connects. Resolves ENCRYPTION_KEY from:
 * 1. process.env (from .env or platform env vars)
 * 2. MongoDB AppConfig collection (survives ephemeral filesystems)
 * 3. Auto-generate and save to both MongoDB and .env
 */
export async function ensureEncryptionKey() {
  if (_cachedKey) return;

  // 1. From environment?
  if (process.env.ENCRYPTION_KEY) {
    _cachedKey = process.env.ENCRYPTION_KEY;
    // Also persist to MongoDB if not already there
    try {
      await AppConfig.updateOne(
        { key: 'ENCRYPTION_KEY' },
        { $setOnInsert: { key: 'ENCRYPTION_KEY', value: _cachedKey } },
        { upsert: true }
      );
    } catch (e) {
      // DB not available — fine, env var is sufficient
    }
    return;
  }

  // 2. From MongoDB?
  try {
    const stored = await AppConfig.findOne({ key: 'ENCRYPTION_KEY' });
    if (stored) {
      process.env.ENCRYPTION_KEY = stored.value;
      _cachedKey = stored.value;
      console.log('[Security] Loaded ENCRYPTION_KEY from database');
      return;
    }
  } catch (e) {
    // DB not available — fall through to generate
  }

  // 3. Generate new key, save everywhere
  const generated = crypto.randomBytes(32).toString('hex');
  process.env.ENCRYPTION_KEY = generated;
  _cachedKey = generated;

  try {
    await AppConfig.create({ key: 'ENCRYPTION_KEY', value: generated });
    console.log('[Security] Generated new ENCRYPTION_KEY and saved to database');
  } catch (e) {
    console.log('[Security] Generated new ENCRYPTION_KEY (could not save to database)');
  }

  // Also save to .env (local dev convenience, best-effort)
  try {
    const envPath = path.resolve(process.cwd(), '.env');
    fs.appendFileSync(envPath, `\nENCRYPTION_KEY=${generated}\n`);
  } catch (e) {
    // Ephemeral filesystem — expected on Render, ignore
  }
}

function getValidKey() {
  const key = process.env.ENCRYPTION_KEY || _cachedKey;
  if (!key) {
    throw new Error('ENCRYPTION_KEY not initialized. Call ensureEncryptionKey() at startup.');
  }
  // Hash the key to ensure it's exactly 32 bytes (256 bits)
  return crypto.createHash('sha256').update(String(key)).digest('base64').substring(0, 32);
}

function encryptToken(text) {
  if (!text) return text;
  try {
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv(ALGORITHM, getValidKey(), iv);
    let encrypted = cipher.update(text, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    return iv.toString('hex') + ':' + encrypted;
  } catch (err) {
    console.error('[Encryption] Failed to encrypt token');
    return text; // Fallback, though ideally it should throw in a strict system
  }
}

function decryptToken(text) {
  if (!text) return text;
  // Check if it looks like our encrypted format (iv:data)
  if (!text.includes(':')) {
    // Legacy plain-text token
    return text; 
  }
  
  try {
    const textParts = text.split(':');
    const iv = Buffer.from(textParts.shift(), 'hex');
    const encryptedText = Buffer.from(textParts.join(':'), 'hex');
    const decipher = crypto.createDecipheriv(ALGORITHM, getValidKey(), iv);
    let decrypted = decipher.update(encryptedText, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    return decrypted;
  } catch (err) {
    console.error('[Encryption] Failed to decrypt token - it may be corrupted or from an old key.');
    return null; // Return null if decryption fails (forces user to re-auth)
  }
}
// --------------------------

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
        'openid',
        'email',
        'profile',
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/gmail.send',
        'https://www.googleapis.com/auth/gmail.readonly',
        'https://www.googleapis.com/auth/gmail.compose',
      ],
      redirectUri: callbackUrl,
      extraParams: { access_type: 'offline', prompt: 'consent' },
    },
    github: {
      authUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      clientId: process.env.OAUTH_GITHUB_CLIENT_ID || '',
      clientSecret: process.env.OAUTH_GITHUB_CLIENT_SECRET || '',
      scopes: ['repo', 'read:user', 'read:org', 'models:read'],
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
        'manage:jira-project',
        'manage:jira-configuration',
        'read:board-scope:jira-software',
        'read:sprint:jira-software', 'write:sprint:jira-software',
        'read:issue:jira-software', 'write:issue:jira-software',
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

  const tokens = user.tokens[provider];

  // Decrypt tokens before returning to the application
  // Use lean object extraction to avoid Mongoose subdocument issues
  const plain = typeof tokens.toObject === 'function' ? tokens.toObject() : { ...tokens };
  return {
    ...plain,
    access_token: decryptToken(tokens.access_token),
    refresh_token: tokens.refresh_token ? decryptToken(tokens.refresh_token) : undefined
  };
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
    [`tokens.${provider}.access_token`]: encryptToken(tokenData.access_token),
    [`tokens.${provider}.token_type`]: tokenData.token_type || 'Bearer',
    [`tokens.${provider}.scope`]: tokenData.scope || '',
    [`tokens.${provider}.expires_at`]: expiresAt,
  };

  if (tokenData.refresh_token) {
    update[`tokens.${provider}.refresh_token`] = encryptToken(tokenData.refresh_token);
  }

  if (tokenData.cloud_id) update[`tokens.${provider}.cloud_id`] = tokenData.cloud_id;
  if (tokenData.cloud_url) update[`tokens.${provider}.cloud_url`] = tokenData.cloud_url;

  await User.findByIdAndUpdate(userId, { $set: update }, { upsert: true });
  console.log(`[OAuth] Stored encrypted tokens for user ${userId}, provider ${provider}, scope: ${tokenData.scope || '(none)'}`);
}

export async function clearTokens(userId, provider) {
  await User.findByIdAndUpdate(userId, { $unset: { [`tokens.${provider}`]: "" } });
  console.log(`[OAuth] Cleared tokens for user ${userId}, provider ${provider}`);
}

export async function fetchProviderUsername(provider, accessToken, cloudId) {
  try {
    let url, headers, extractUsername;
    switch (provider) {
      case 'google':
        url = 'https://www.googleapis.com/oauth2/v2/userinfo';
        headers = { Authorization: `Bearer ${accessToken}` };
        extractUsername = (data) => data.email;
        break;
      case 'github':
        url = 'https://api.github.com/user';
        headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github.v3+json' };
        extractUsername = (data) => data.login;
        break;
      case 'slack':
        url = 'https://slack.com/api/auth.test';
        headers = { Authorization: `Bearer ${accessToken}` };
        extractUsername = (data) => data.user;
        break;
      case 'figma':
        url = 'https://api.figma.com/v1/me';
        headers = { Authorization: `Bearer ${accessToken}` };
        extractUsername = (data) => data.handle;
        break;
      case 'jira':
        if (!cloudId) return null;
        url = `https://api.atlassian.com/ex/jira/${cloudId}/rest/api/3/myself`;
        headers = { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' };
        extractUsername = (data) => data.displayName;
        break;
      default:
        return null;
    }
    const res = await fetch(url, { headers });
    if (!res.ok) return null;
    const data = await res.json();
    return extractUsername(data) || null;
  } catch (err) {
    console.warn(`[OAuth] Failed to fetch ${provider} username:`, err.message);
    return null;
  }
}

const REQUIRED_AGILE_SCOPES = [
  'read:board-scope:jira-software',
  'read:sprint:jira-software',
  'write:sprint:jira-software',
];

export function checkJiraAgileScopesFromToken(tokens) {
  const grantedScope = tokens?.scope || '';
  if (!grantedScope) return { hasAgileScopes: null, reason: 'unknown' };
  const grantedSet = new Set(grantedScope.split(' '));
  const missing = REQUIRED_AGILE_SCOPES.filter(s => !grantedSet.has(s));
  if (missing.length > 0) {
    return { hasAgileScopes: false, reason: 'missing_scopes', missing };
  }
  return { hasAgileScopes: true };
}

export async function getConnectionStatus(userId) {
  const user = await User.findById(userId);
  const status = {};
  const providers = getOAuthProviders();

  for (const provider of Object.keys(providers)) {
    const tokens = user?.tokens?.[provider];

    // Test decryption to ensure key matches
    let isValid = false;
    if (tokens?.access_token) {
       const decrypted = decryptToken(tokens.access_token);
       isValid = decrypted !== null;
    }

    const entry = {
      connected: isValid,
      expired: tokens ? isTokenExpired(tokens) : true,
      hasRefreshToken: !!tokens?.refresh_token,
      username: user?.oauthUsernames?.[provider] || null,
    };

    if (provider === 'jira' && isValid) {
      const scopeCheck = checkJiraAgileScopesFromToken(tokens);
      entry.agileEnabled = scopeCheck.hasAgileScopes;
    }

    status[provider] = entry;
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

// Mutex to prevent concurrent refresh requests for the same user+provider
const refreshLocks = new Map();

export async function getValidToken(userId, provider) {
  const tokens = await getStoredTokens(userId, provider);
  if (!tokens) return null;

  if (isTokenExpired(tokens) && tokens.refresh_token) {
    const lockKey = `${userId}:${provider}`;
    // If a refresh is already in-flight, await it instead of starting another
    if (refreshLocks.has(lockKey)) {
      try {
        return await refreshLocks.get(lockKey);
      } catch {
        return null;
      }
    }
    const refreshPromise = refreshAccessToken(userId, provider)
      .finally(() => refreshLocks.delete(lockKey));
    refreshLocks.set(lockKey, refreshPromise);
    try {
      return await refreshPromise;
    } catch (err) {
      console.error(`[OAuth] Auto-refresh failed for ${provider}:`, err.message);
      return null;
    }
  }
  return tokens.access_token;
}

export const GOOGLE_AUTH_SCOPES = ['openid', 'email', 'profile'];

export function buildAuthUrl(provider, state, scopes) {
  const config = getOAuthProviders()[provider];
  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    state: state,
    ...config.extraParams,
  });

  const scopeList = scopes || config.scopes;
  if (provider === 'slack') {
    params.set('scope', scopeList.join(','));
  } else {
    params.set('scope', scopeList.join(' '));
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

export async function fetchGoogleUserInfo(accessToken) {
  const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { 'Authorization': `Bearer ${accessToken}` },
  });
  if (!response.ok) throw new Error(`Failed to fetch Google user info: ${response.status}`);
  const data = await response.json();
  return { email: data.email, name: data.name, picture: data.picture };
}
