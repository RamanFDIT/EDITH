/**
 * oauthService.js — Centralized OAuth2.0 Service for E.D.I.T.H.
 * 
 * Replaces all manual API key entry with "Sign in with X" OAuth flows.
 * Tokens are stored securely in electron-store and auto-refreshed.
 * 
 * Supported providers:
 *   - Google (Calendar + Gemini API via Google Cloud OAuth)
 *   - GitHub
 *   - Slack
 *   - Figma
 *   - Atlassian/Jira (OAuth 2.0 3LO)
 */

import { BrowserWindow } from 'electron';
import crypto from 'crypto';
import http from 'http';
import { URL } from 'url';
import fetch from 'node-fetch';
import store from './store.js';

// =============================================================================
// PROVIDER CONFIGURATIONS (lazy — reads process.env at call-time)
// =============================================================================
// In production, embed your own OAuth Client IDs here (or load from a bundled config).
// Users never see these — they just click "Connect".

function getOAuthProviders() {
  return {
    google: {
      authUrl: 'https://accounts.google.com/o/oauth2/v2/auth',
      tokenUrl: 'https://oauth2.googleapis.com/token',
      clientId: process.env.OAUTH_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID || '',
      clientSecret: process.env.OAUTH_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET || '',
      scopes: [
        'https://www.googleapis.com/auth/calendar',
        'https://www.googleapis.com/auth/calendar.events',
        'https://www.googleapis.com/auth/cloud-platform',           // Vertex AI (Gemini)
        'https://www.googleapis.com/auth/generative-language.retriever',
        'https://www.googleapis.com/auth/gmail.send',               // Gmail: send emails
        'https://www.googleapis.com/auth/gmail.readonly',           // Gmail: read inbox
        'https://www.googleapis.com/auth/gmail.compose',            // Gmail: compose/draft
      ],
      redirectUri: 'http://localhost:18923/oauth/callback',
      extraParams: { access_type: 'offline', prompt: 'consent' },
    },

    github: {
      authUrl: 'https://github.com/login/oauth/authorize',
      tokenUrl: 'https://github.com/login/oauth/access_token',
      clientId: process.env.OAUTH_GITHUB_CLIENT_ID || '',
      clientSecret: process.env.OAUTH_GITHUB_CLIENT_SECRET || '',
      scopes: ['repo', 'read:user', 'read:org'],
      redirectUri: 'http://localhost:18923/oauth/callback',
      extraParams: {},
    },

    slack: {
      authUrl: 'https://slack.com/oauth/v2/authorize',
      tokenUrl: 'https://slack.com/api/oauth.v2.access',
      clientId: process.env.OAUTH_SLACK_CLIENT_ID || '',
      clientSecret: process.env.OAUTH_SLACK_CLIENT_SECRET || '',
      scopes: ['chat:write', 'channels:read', 'channels:join', 'chat:write.customize'],
      redirectUri: process.env.OAUTH_SLACK_REDIRECT_URI || 'https://localhost:18923/oauth/callback',
      extraParams: {},
      isBotScope: true,
    },

    figma: {
      authUrl: 'https://www.figma.com/oauth',
      tokenUrl: 'https://api.figma.com/v1/oauth/token',
      clientId: process.env.OAUTH_FIGMA_CLIENT_ID || '',
      clientSecret: process.env.OAUTH_FIGMA_CLIENT_SECRET || '',
      scopes: ['file_content:read', 'file_comments:read', 'file_comments:write'],
      redirectUri: 'http://localhost:18923/oauth/callback',
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
      redirectUri: 'http://localhost:18923/oauth/callback',
      extraParams: { audience: 'api.atlassian.com', prompt: 'consent' },
    },
  };
}

// =============================================================================
// TOKEN STORAGE HELPERS
// =============================================================================

function getTokenKey(provider) {
  return `oauth_${provider}`;
}

/**
 * Get stored OAuth tokens for a provider
 * @param {string} provider - Provider name (google, github, slack, figma, jira)
 * @returns {object|null} - { access_token, refresh_token, expires_at, ... } or null
 */
export function getStoredTokens(provider) {
  const data = store.get(getTokenKey(provider));
  if (!data || !data.access_token) return null;
  return data;
}

/**
 * Check if a provider's token is expired (with 5-min buffer)
 */
export function isTokenExpired(provider) {
  const tokens = getStoredTokens(provider);
  if (!tokens || !tokens.expires_at) return true;
  return Date.now() > (tokens.expires_at - 5 * 60 * 1000);
}

/**
 * Store tokens for a provider
 */
function storeTokens(provider, tokenData) {
  const toStore = {
    access_token: tokenData.access_token,
    refresh_token: tokenData.refresh_token || getStoredTokens(provider)?.refresh_token || null,
    token_type: tokenData.token_type || 'Bearer',
    scope: tokenData.scope || '',
    expires_at: tokenData.expires_in
      ? Date.now() + tokenData.expires_in * 1000
      : null,
  };

  // Jira-specific: store cloud ID for API base URL
  if (tokenData.cloud_id) {
    toStore.cloud_id = tokenData.cloud_id;
  }
  if (tokenData.cloud_url) {
    toStore.cloud_url = tokenData.cloud_url;
  }

  // Slack-specific: store team info
  if (tokenData.team) {
    toStore.team = tokenData.team;
  }
  if (tokenData.bot_user_id) {
    toStore.bot_user_id = tokenData.bot_user_id;
  }

  store.set(getTokenKey(provider), toStore);
  console.log(`[OAuth] Stored tokens for "${provider}"`);
  return toStore;
}

/**
 * Clear stored tokens for a provider (disconnect)
 */
export function clearTokens(provider) {
  store.delete(getTokenKey(provider));
  console.log(`[OAuth] Cleared tokens for "${provider}"`);
}

/**
 * Get the status of all OAuth connections
 * @returns {object} - { google: { connected: true, expired: false }, ... }
 */
export function getConnectionStatus() {
  const status = {};
  for (const provider of Object.keys(getOAuthProviders())) {
    const tokens = getStoredTokens(provider);
    status[provider] = {
      connected: !!tokens,
      expired: tokens ? isTokenExpired(provider) : true,
      hasRefreshToken: !!tokens?.refresh_token,
    };
  }
  return status;
}

// =============================================================================
// TOKEN REFRESH
// =============================================================================

/**
 * Refresh an expired access token using the stored refresh token.
 * @param {string} provider 
 * @returns {string} Fresh access token
 */
export async function refreshAccessToken(provider) {
  const config = getOAuthProviders()[provider];
  const tokens = getStoredTokens(provider);

  if (!tokens?.refresh_token) {
    throw new Error(`No refresh token stored for "${provider}". User must re-authenticate.`);
  }

  console.log(`[OAuth] Refreshing token for "${provider}"...`);

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

  if (!response.ok) {
    const err = await response.text();
    console.error(`[OAuth] Refresh failed for "${provider}":`, err);
    throw new Error(`Token refresh failed for ${provider}: ${err}`);
  }

  const data = await response.json();
  storeTokens(provider, data);
  console.log(`[OAuth] Token refreshed for "${provider}"`);
  return data.access_token;
}

/**
 * Get a valid access token — refresh automatically if expired.
 * @param {string} provider 
 * @returns {string|null} Access token or null if not connected
 */
export async function getValidToken(provider) {
  const tokens = getStoredTokens(provider);
  if (!tokens) return null;

  if (isTokenExpired(provider) && tokens.refresh_token) {
    try {
      return await refreshAccessToken(provider);
    } catch (err) {
      console.error(`[OAuth] Auto-refresh failed for "${provider}":`, err.message);
      return null;
    }
  }

  return tokens.access_token;
}

// =============================================================================
// JIRA: DISCOVER CLOUD ID (needed for API calls)
// =============================================================================

async function discoverJiraCloudId(accessToken) {
  const response = await fetch('https://api.atlassian.com/oauth/token/accessible-resources', {
    headers: { 'Authorization': `Bearer ${accessToken}`, 'Accept': 'application/json' },
  });

  if (!response.ok) throw new Error('Failed to fetch Jira accessible resources');

  const sites = await response.json();
  if (sites.length === 0) throw new Error('No Jira sites found for this account');

  // Use the first site (most users have one)
  return { cloud_id: sites[0].id, cloud_url: sites[0].url, site_name: sites[0].name };
}

// =============================================================================
// OAUTH FLOW (Electron BrowserWindow + local callback server)
// =============================================================================

/**
 * Build the authorization URL for a provider
 */
function buildAuthUrl(provider) {
  const config = getOAuthProviders()[provider];
  const state = crypto.randomBytes(16).toString('hex');

  const params = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: config.redirectUri,
    response_type: 'code',
    state: state,
    ...config.extraParams,
  });

  // Slack uses "scope" for bot scopes
  if (provider === 'slack') {
    params.set('scope', config.scopes.join(','));
  } else if (provider === 'figma') {
    // Figma: only add scope if scopes are specified; otherwise Figma uses app-configured scopes
    if (config.scopes.length > 0) {
      // Build scope manually to avoid URL-encoding colons in scope names
      const scopeStr = config.scopes.join(',');
      // We'll append scope to the URL directly to avoid double-encoding
      const baseUrl = `${config.authUrl}?${params.toString()}&scope=${scopeStr}`;
      return { url: baseUrl, state };
    }
  } else {
    params.set('scope', config.scopes.join(' '));
  }

  return { url: `${config.authUrl}?${params.toString()}`, state };
}

/**
 * Exchange authorization code for tokens
 */
async function exchangeCodeForTokens(provider, code) {
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

  if (!response.ok) {
    const errText = await response.text();
    throw new Error(`Token exchange failed for ${provider}: ${errText}`);
  }

  const data = await response.json();

  // Slack nests the token differently
  if (provider === 'slack' && data.ok) {
    return {
      access_token: data.access_token,
      token_type: 'Bearer',
      scope: data.scope,
      team: data.team,
      bot_user_id: data.bot_user_id,
    };
  }

  return data;
}

/**
 * Launch OAuth flow for a provider.
 * Opens an Electron BrowserWindow, starts a temporary local server for the callback.
 * 
 * @param {string} provider - One of: google, github, slack, figma, jira
 * @returns {Promise<object>} - The stored token data
 */
export function startOAuthFlow(provider) {
  return new Promise((resolve, reject) => {
    const config = getOAuthProviders()[provider];

    if (!config.clientId || !config.clientSecret) {
      reject(new Error(
        `OAuth not configured for "${provider}". ` +
        `Set OAUTH_${provider.toUpperCase()}_CLIENT_ID and OAUTH_${provider.toUpperCase()}_CLIENT_SECRET in your environment.`
      ));
      return;
    }

    const { url: authUrl, state: expectedState } = buildAuthUrl(provider);
    let callbackServer;
    let authWindow;
    let resolved = false;

    // --- Shared handler for the OAuth callback URL ---
    async function handleCallback(callbackUrl) {
      if (resolved) return;
      resolved = true;
      try {
        const reqUrl = new URL(callbackUrl);
        const code = reqUrl.searchParams.get('code');
        const state = reqUrl.searchParams.get('state');
        const error = reqUrl.searchParams.get('error');

        if (error) {
          cleanup();
          reject(new Error(`OAuth denied: ${error}`));
          return;
        }

        if (state !== expectedState) {
          cleanup();
          reject(new Error('OAuth state mismatch'));
          return;
        }

        const tokenData = await exchangeCodeForTokens(provider, code);

        if (provider === 'jira') {
          const jiraInfo = await discoverJiraCloudId(tokenData.access_token);
          tokenData.cloud_id = jiraInfo.cloud_id;
          tokenData.cloud_url = jiraInfo.cloud_url;
        }

        const stored = storeTokens(provider, tokenData);
        populateEnvFromOAuth(provider, stored);

        cleanup();
        resolve(stored);
      } catch (err) {
        cleanup();
        reject(err);
      }
    }

    function cleanup() {
      if (callbackServer) {
        try { callbackServer.close(); } catch (e) { /* ignore */ }
        callbackServer = null;
      }
      if (authWindow && !authWindow.isDestroyed()) {
        authWindow.close();
        authWindow = null;
      }
    }

    // --- For HTTPS redirect URIs (e.g. Slack): intercept in BrowserWindow ---
    if (config.redirectUri.startsWith('https://localhost')) {
      console.log(`[OAuth] Using BrowserWindow redirect interception for "${provider}"`);

      authWindow = new BrowserWindow({
        width: 600,
        height: 800,
        title: `Connect ${provider.charAt(0).toUpperCase() + provider.slice(1)}`,
        webPreferences: { nodeIntegration: false, contextIsolation: true },
      });

      // Intercept navigation to the redirect URI before the browser tries to connect
      authWindow.webContents.on('will-redirect', (event, url) => {
        if (url.startsWith(config.redirectUri)) {
          event.preventDefault();
          handleCallback(url);
        }
      });

      authWindow.webContents.on('will-navigate', (event, url) => {
        if (url.startsWith(config.redirectUri)) {
          event.preventDefault();
          handleCallback(url);
        }
      });

      authWindow.loadURL(authUrl);
      authWindow.setMenuBarVisibility(false);

      authWindow.on('closed', () => {
        authWindow = null;
        setTimeout(() => {
          if (!resolved) cleanup();
        }, 1000);
      });

    } else {
      // --- For HTTP redirect URIs: use local callback server ---
      callbackServer = http.createServer(async (req, res) => {
        try {
          const reqUrl = new URL(req.url, 'http://localhost:18923');

          if (reqUrl.pathname === '/oauth/callback') {
            const code = reqUrl.searchParams.get('code');
            const state = reqUrl.searchParams.get('state');
            const error = reqUrl.searchParams.get('error');

            if (error) {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end('<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0a;color:#ff4444"><h2>Authorization Denied</h2><p>You can close this window.</p></body></html>');
              cleanup();
              reject(new Error(`OAuth denied: ${error}`));
              return;
            }

            if (state !== expectedState) {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end('<html><body>State mismatch — potential CSRF. Close this window and try again.</body></html>');
              cleanup();
              reject(new Error('OAuth state mismatch'));
              return;
            }

            const tokenData = await exchangeCodeForTokens(provider, code);

            if (provider === 'jira') {
              const jiraInfo = await discoverJiraCloudId(tokenData.access_token);
              tokenData.cloud_id = jiraInfo.cloud_id;
              tokenData.cloud_url = jiraInfo.cloud_url;
            }

            const stored = storeTokens(provider, tokenData);
            populateEnvFromOAuth(provider, stored);

            res.writeHead(200, { 'Content-Type': 'text/html' });
            res.end(`<html><body style="font-family:sans-serif;text-align:center;padding:60px;background:#0a0a0a;color:#00ff88"><h2>Connected to ${provider.charAt(0).toUpperCase() + provider.slice(1)}!</h2><p>You can close this window.</p></body></html>`);

            cleanup();
            resolve(stored);
          }
        } catch (err) {
          res.writeHead(500, { 'Content-Type': 'text/html' });
          res.end(`<html><body>Error: ${err.message}</body></html>`);
          cleanup();
          reject(err);
        }
      });

      callbackServer.listen(18923, () => {
        console.log(`[OAuth] Callback server listening for "${provider}" on port 18923`);

        authWindow = new BrowserWindow({
          width: 600,
          height: 800,
          title: `Connect ${provider.charAt(0).toUpperCase() + provider.slice(1)}`,
          webPreferences: { nodeIntegration: false, contextIsolation: true },
        });

        authWindow.loadURL(authUrl);
        authWindow.setMenuBarVisibility(false);

        authWindow.on('closed', () => {
          authWindow = null;
          setTimeout(() => cleanup(), 1000);
        });
      });
    }
  });
}

// =============================================================================
// ENV POPULATION (bridge OAuth tokens → process.env for tool compatibility)
// =============================================================================

/**
 * Populate process.env from stored OAuth tokens so existing tools work without changes.
 * Called on startup and after each OAuth flow completes.
 */
export function populateEnvFromOAuth(provider, tokens) {
  if (!tokens?.access_token) return;

  switch (provider) {
    case 'google': {
      process.env.GOOGLE_REFRESH_TOKEN = tokens.refresh_token || '';
      process.env.GOOGLE_OAUTH_ACCESS_TOKEN = tokens.access_token || '';
      // Also ensure the calendar tool can find the client ID/secret used for this OAuth flow
      const googleCfg = getOAuthProviders().google;
      if (googleCfg.clientId) process.env.GOOGLE_CLIENT_ID = googleCfg.clientId;
      if (googleCfg.clientSecret) process.env.GOOGLE_CLIENT_SECRET = googleCfg.clientSecret;
      // Vertex AI needs these for OAuth-based Gemini access
      process.env.GOOGLE_VERTEX_AI_OAUTH = 'true';
      break;
    }

    case 'github':
      process.env.GITHUB_TOKEN = tokens.access_token;
      process.env.GITHUB_PAT = tokens.access_token;
      process.env.GITHUB_PERSONAL_ACCESS_TOKEN = tokens.access_token;
      break;

    case 'slack':
      process.env.SLACK_BOT_TOKEN = tokens.access_token;
      break;

    case 'figma':
      process.env.FIGMA_TOKEN = tokens.access_token;
      process.env.FIGMA_API_KEY = tokens.access_token;
      break;

    case 'jira':
      process.env.JIRA_API_TOKEN = tokens.access_token;
      process.env.JIRA_OAUTH_TOKEN = tokens.access_token;
      if (tokens.cloud_url) {
        // Extract domain from cloud_url (e.g., "https://your-site.atlassian.net" → "your-site.atlassian.net")
        process.env.JIRA_DOMAIN = tokens.cloud_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
      }
      if (tokens.cloud_id) {
        process.env.JIRA_CLOUD_ID = tokens.cloud_id;
      }
      break;
  }

  console.log(`[OAuth] Populated process.env for "${provider}"`);
}

/**
 * On app startup, populate process.env from all stored OAuth tokens
 */
export function populateAllEnvFromOAuth() {
  for (const provider of Object.keys(getOAuthProviders())) {
    const tokens = getStoredTokens(provider);
    if (tokens) {
      populateEnvFromOAuth(provider, tokens);
    }
  }
}
