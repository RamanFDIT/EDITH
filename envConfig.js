import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import store from './store.js';

// 1. Try loading from the local project folder (Development)
// This looks for .env in the current working directory
dotenv.config();

// 2. Try loading from the User's Home Directory (Distribution)
// This allows you to share the .exe, and the user just needs to put their keys in their home folder.
// Windows: C:\Users\Username\.edith.env
// Mac/Linux: ~/.edith.env
const homeConfigPath = path.join(os.homedir(), '.edith.env');
dotenv.config({ path: homeConfigPath });

// 3. Load from electron-store (UI Settings)
const storeConfig = store.store;
for (const key in storeConfig) {
  if (storeConfig[key]) {
    process.env[key] = storeConfig[key];
  }
}

// 4. Populate process.env from stored OAuth tokens (electron-store).
//    This ensures tokens obtained via the OAuth UI flow override stale .env values.
//    Mirrors the logic in oauthService.js populateEnvFromOAuth() but without
//    importing Electron-dependent modules, so it works in all contexts (Electron, PM2, node).
const oauthGoogle = store.get('oauth_google');
if (oauthGoogle?.access_token) {
  if (oauthGoogle.refresh_token) {
    process.env.GOOGLE_REFRESH_TOKEN = oauthGoogle.refresh_token;
    console.log('[Config] Google refresh token loaded from OAuth store (overrides .env)');
  }
  process.env.GOOGLE_OAUTH_ACCESS_TOKEN = oauthGoogle.access_token;
  // Ensure GOOGLE_CLIENT_ID / SECRET point to the OAuth app (not legacy .env values).
  // The OAuth flow uses OAUTH_GOOGLE_CLIENT_ID; the tools read GOOGLE_CLIENT_ID.
  const oauthClientId = process.env.OAUTH_GOOGLE_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
  const oauthClientSecret = process.env.OAUTH_GOOGLE_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
  if (oauthClientId) process.env.GOOGLE_CLIENT_ID = oauthClientId;
  if (oauthClientSecret) process.env.GOOGLE_CLIENT_SECRET = oauthClientSecret;
}

const oauthGithub = store.get('oauth_github');
if (oauthGithub?.access_token) {
  process.env.GITHUB_TOKEN = oauthGithub.access_token;
  process.env.GITHUB_PAT = oauthGithub.access_token;
  process.env.GITHUB_PERSONAL_ACCESS_TOKEN = oauthGithub.access_token;
}

const oauthSlack = store.get('oauth_slack');
if (oauthSlack?.access_token) {
  process.env.SLACK_BOT_TOKEN = oauthSlack.access_token;
}

const oauthFigma = store.get('oauth_figma');
if (oauthFigma?.access_token) {
  process.env.FIGMA_TOKEN = oauthFigma.access_token;
  process.env.FIGMA_API_KEY = oauthFigma.access_token;
}

const oauthJira = store.get('oauth_jira');
if (oauthJira?.access_token) {
  process.env.JIRA_API_TOKEN = oauthJira.access_token;
  process.env.JIRA_OAUTH_TOKEN = oauthJira.access_token;
  if (oauthJira.cloud_url) {
    process.env.JIRA_DOMAIN = oauthJira.cloud_url.replace(/^https?:\/\//, '').replace(/\/$/, '');
  }
  if (oauthJira.cloud_id) {
    process.env.JIRA_CLOUD_ID = oauthJira.cloud_id;
  }
}

console.log(`[Config] Loaded environment. Checked: .env, ${homeConfigPath}, and electron-store`);
