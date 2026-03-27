import express from 'express';
import { streamWithSemanticRouting, clearLLMCacheForUser } from './agent.js';
import cors from 'cors';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';
import fs from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- Boot diagnostics (remove after debugging) ---
console.log('[BOOT] __dirname:', __dirname);
console.log('[BOOT] cwd:', process.cwd());
const _distPath = path.join(__dirname, 'frontend', 'dist');
console.log('[BOOT] dist path:', _distPath);
console.log('[BOOT] dist exists:', fs.existsSync(_distPath));
console.log('[BOOT] index.html exists:', fs.existsSync(path.join(_distPath, 'index.html')));
if (fs.existsSync(_distPath)) {
    console.log('[BOOT] dist contents:', fs.readdirSync(_distPath).join(', '));
} else {
    const _frontendPath = path.join(__dirname, 'frontend');
    console.log('[BOOT] frontend exists:', fs.existsSync(_frontendPath));
    if (fs.existsSync(_frontendPath)) {
        console.log('[BOOT] frontend contents:', fs.readdirSync(_frontendPath).join(', '));
    }
}

import { exec } from 'child_process';
import { promisify } from 'util';
import os from 'os';
import bcrypt from 'bcryptjs';
import { transcribeAudio, generateSpeech } from './audioTool.js';
import { connectDB, Chat, User, Project } from './db.js';
import { ensureEncryptionKey, getValidToken, getStoredTokens } from './oauthService.js';

// Connect to Database, then initialize encryption key
connectDB().then(() => ensureEncryptionKey()).catch(err => {
  console.error('[Startup] Failed to initialize encryption key:', err.message);
});

const execAsync = promisify(exec);

const app = express();
const port = 3000;

// --- CONFIG: Multer (File Uploads) ---
const uploadDir = path.join(os.tmpdir(), 'edith-uploads');
if (!fs.existsSync(uploadDir)) fs.mkdirSync(uploadDir, { recursive: true });

const storage = multer.diskStorage({
    destination: (req, file, cb) => cb(null, uploadDir),
    filename: (req, file, cb) => cb(null, `voice-${Date.now()}.webm`)
});
const upload = multer({ storage: storage });
const voiceUpload = multer({ storage: multer.memoryStorage() });

// --- Middlewares ---
app.use(express.json({ limit: '1mb' }));
const FRONTEND_ORIGIN = process.env.CORS_ORIGIN || process.env.APP_URL || 'http://localhost:5173';
const allowedOrigins = [
  FRONTEND_ORIGIN,
  'http://localhost:5173',
  'http://localhost:3000',
  'https://edith-1-2sxz.onrender.com'
];

app.use(cors({ 
  origin: function (origin, callback) {
    // allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    // Allow any Render frontend just to be safe
    if (origin.endsWith('.onrender.com')) {
      return callback(null, true);
    }
    return callback(new Error('CORS blocked origin: ' + origin), false);
  }, 
  credentials: true 
}));
app.use(express.static(path.join(__dirname, 'frontend', 'dist'))); // Only serve built frontend
app.use('/uploads', express.static(uploadDir)); // Serve uploaded files under /uploads

// --- Global Request Logger ---
app.use((req, res, next) => {
    console.log(`[HTTP] ${req.method} ${req.url}`);
    next();
});

// --- Middleware: User Isolation ---
async function extractUser(req, res, next) {
    const userEmail = req.headers['x-user-email'];
    const userId = req.headers['x-user-id'] || req.query.userId;

    try {
        let user = null;

        // Prefer X-User-Email (Google Sign-In identity)
        if (userEmail) {
            user = await User.findOne({ email: userEmail });
        }

        // Fall back to X-User-ID (legacy random UUID → @edith.local)
        if (!user && userId) {
            user = await User.findOne({ email: `${userId}@edith.local` });
            if (!user) {
                user = await User.create({
                    email: `${userId}@edith.local`,
                    name: `User ${userId.substring(0, 8)}`,
                    authProvider: 'local'
                });
                console.log(`[User] Created new local user: ${userId}`);
            }
        }

        if (!user) {
            return res.status(401).json({ error: 'No user identity provided' });
        }

        req.user = user;
        next();
    } catch (err) {
        console.error('[User] Middleware error:', err);
        res.status(500).json({ error: 'Failed to identify user' });
    }
}

// --- API: File Upload ---
const fileUpload = multer({
    storage: multer.diskStorage({
        destination: (req, file, cb) => cb(null, uploadDir),
        filename: (req, file, cb) => cb(null, `upload-${Date.now()}-${file.originalname}`)
    }),
    limits: { fileSize: 20 * 1024 * 1024 } // 20MB
});

app.post('/api/upload', fileUpload.array('files', 10), (req, res) => {
    if (!req.files || req.files.length === 0) {
        return res.status(400).json({ error: 'No files uploaded.' });
    }
    const uploaded = req.files.map(f => ({
        originalName: f.originalname,
        path: path.resolve(f.path),
        size: f.size,
    }));
    console.log(`[Server] Uploaded ${uploaded.length} file(s):`, uploaded.map(f => f.originalName));
    res.json({ files: uploaded });
});

import {
    buildAuthUrl,
    GOOGLE_AUTH_SCOPES,
    exchangeCodeForTokens,
    storeTokens,
    getConnectionStatus,
    clearTokens,
    discoverJiraCloudId,
    fetchGoogleUserInfo,
    fetchProviderUsername
} from './oauthService.js';
import crypto from 'crypto';

// --- API: Auth (Google Sign-In) ---

app.get('/api/auth/google', (req, res) => {
    try {
        const state = `auth__${crypto.randomBytes(16).toString('hex')}`;
        const authUrl = buildAuthUrl('google', state, GOOGLE_AUTH_SCOPES);
        res.json({ url: authUrl });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- API: Email/Password Auth ---
app.post('/api/auth/register', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
            return res.status(400).json({ error: 'Valid email is required' });
        }
        if (!password || password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const existing = await User.findOne({ email: email.toLowerCase() });
        if (existing) {
            return res.status(409).json({ error: 'An account with this email already exists' });
        }

        const hash = await bcrypt.hash(password, 10);
        const user = await User.create({
            email: email.toLowerCase(),
            name: '',
            password: hash,
            authProvider: 'local'
        });

        console.log(`[Auth] Created new local user: ${user.email}`);
        res.json({ email: user.email, name: '' });
    } catch (error) {
        console.error('[Auth Register] Error:', error);
        res.status(500).json({ error: 'Registration failed' });
    }
});

app.post('/api/auth/login', async (req, res) => {
    try {
        const { email, password } = req.body;

        if (!email || !password) {
            return res.status(400).json({ error: 'Email and password are required' });
        }

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user || !user.password) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const valid = await bcrypt.compare(password, user.password);
        if (!valid) {
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        console.log(`[Auth] Local login: ${user.email}`);
        res.json({
            email: user.email,
            name: user.name || '',
            preferredName: user.preferredName || '',
            titlePreference: user.titlePreference || 'Sir'
        });
    } catch (error) {
        console.error('[Auth Login] Error:', error);
        res.status(500).json({ error: 'Login failed' });
    }
});

// --- Password Reset ---
app.post('/api/auth/forgot-password', async (req, res) => {
    try {
        const { email } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user || !user.password) {
            // Don't reveal whether email exists — return success either way
            return res.json({ success: true });
        }

        // Generate 6-digit reset code
        const resetCode = crypto.randomInt(100000, 999999).toString();
        user.resetToken = resetCode;
        user.resetTokenExpires = new Date(Date.now() + 15 * 60 * 1000); // 15 minutes
        await user.save();

        console.log(`[Auth] Password reset code generated for ${email}: ${resetCode}`);
        // In production, this would be sent via email. For capstone demo, return in response.
        res.json({ success: true, resetCode });
    } catch (error) {
        console.error('[Auth Forgot Password] Error:', error);
        res.status(500).json({ error: 'Failed to process request' });
    }
});

app.post('/api/auth/reset-password', async (req, res) => {
    try {
        const { email, resetCode, newPassword } = req.body;
        if (!email || !resetCode || !newPassword) {
            return res.status(400).json({ error: 'Email, reset code, and new password are required' });
        }
        if (newPassword.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        const user = await User.findOne({ email: email.toLowerCase() });
        if (!user || user.resetToken !== resetCode) {
            return res.status(400).json({ error: 'Invalid reset code' });
        }
        if (!user.resetTokenExpires || user.resetTokenExpires < new Date()) {
            return res.status(400).json({ error: 'Reset code has expired. Please request a new one.' });
        }

        user.password = await bcrypt.hash(newPassword, 10);
        user.resetToken = undefined;
        user.resetTokenExpires = undefined;
        await user.save();

        console.log(`[Auth] Password reset successful for ${email}`);
        res.json({ success: true });
    } catch (error) {
        console.error('[Auth Reset Password] Error:', error);
        res.status(500).json({ error: 'Failed to reset password' });
    }
});

app.get('/api/auth/session', async (req, res) => {
    try {
        const email = req.headers['x-user-email'];
        if (!email) return res.json({ valid: false });

        const user = await User.findOne({ email });
        if (!user) return res.json({ valid: false });

        // Check if Google tokens exist and are decryptable
        const status = await getConnectionStatus(user._id);
        const googleValid = status.google?.connected || false;

        res.json({
            valid: true,
            email: user.email,
            name: user.name,
            preferredName: user.preferredName || '',
            titlePreference: user.titlePreference || 'Sir',
            oauthStatus: status,
            onboardingComplete: true
        });
    } catch (error) {
        console.error('[Auth Session] Error:', error);
        res.json({ valid: false });
    }
});

// --- API: OAuth ---

// 1. Get Auth URL
app.get('/api/oauth/connect/:provider', extractUser, async (req, res) => {
    try {
        const { provider } = req.params;
        const userIdentifier = req.user.email;

        // Encode provider AND full email in state so callback knows who sent it
        const state = `${provider}__${userIdentifier}__${crypto.randomBytes(8).toString('hex')}`;

        const authUrl = buildAuthUrl(provider, state);
        res.json({ url: authUrl });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 2. OAuth Callback
app.get('/api/oauth/callback', async (req, res) => {
    try {
        const { code, state, error: oauthError } = req.query;

        if (!state) return res.status(400).send("Missing state parameter");
        if (oauthError) return res.status(400).send(`OAuth Error: ${oauthError}`);

        // --- AUTH SIGN-IN FLOW ---
        if (state.startsWith('auth__')) {
            const tokenData = await exchangeCodeForTokens('google', code);
            const userInfo = await fetchGoogleUserInfo(tokenData.access_token);

            // Find or create user by Google email
            let user = await User.findOne({ email: userInfo.email });
            if (!user) {
                user = await User.create({
                    email: userInfo.email,
                    name: userInfo.name,
                    authProvider: 'google'
                });
                console.log(`[Auth] Created new Google user: ${userInfo.email}`);
            } else {
                // Update name from Google profile if changed
                if (user.name !== userInfo.name) {
                    user.name = userInfo.name;
                    await user.save();
                }
            }

            // Auth tokens only have basic scopes (openid, email, profile)
            // Calendar/Gmail tokens are stored when user connects tools in Settings

            // Redirect back to frontend with auth data in URL params
            // This avoids postMessage/window.opener issues across browsers
            const params = new URLSearchParams({
                email: userInfo.email,
                name: userInfo.name || '',
                preferredName: user.preferredName || '',
                titlePreference: user.titlePreference || 'Sir',
            });
            return res.redirect(`${FRONTEND_ORIGIN}/#/auth/callback?${params.toString()}`);
        }

        // --- TOOL-CONNECTION FLOW ---
        const [provider, ...rest] = state.split('__');
        // userIdentifier is everything between first and last __ segments
        const userIdentifier = rest.slice(0, -1).join('__');

        const tokenData = await exchangeCodeForTokens(provider, code);

        if (provider === 'jira') {
            const jiraInfo = await discoverJiraCloudId(tokenData.access_token);
            tokenData.cloud_id = jiraInfo.cloud_id;
            tokenData.cloud_url = jiraInfo.cloud_url;
        }

        // Find user — detect real email vs legacy @edith.local
        let user;
        if (userIdentifier.includes('@') && !userIdentifier.endsWith('@edith.local')) {
            user = await User.findOne({ email: userIdentifier });
        } else {
            // Legacy: strip @edith.local if present, or use as-is
            const legacyId = userIdentifier.replace(/@edith\.local$/, '');
            user = await User.findOne({ email: `${legacyId}@edith.local` });
            if (!user) {
                user = await User.create({
                    email: `${legacyId}@edith.local`,
                    name: `User ${legacyId.substring(0, 8)}`,
                    authProvider: 'local'
                });
            }
        }

        if (!user) {
            return res.status(400).send('User not found. Please sign in again.');
        }

        await storeTokens(user._id, provider, tokenData);

        // Fetch and store the connected account's username
        try {
            const username = await fetchProviderUsername(provider, tokenData.access_token, tokenData.cloud_id);
            if (username) {
                await User.findByIdAndUpdate(user._id, { $set: { [`oauthUsernames.${provider}`]: username } });
                console.log(`[OAuth] Stored ${provider} username: ${username}`);
            }
        } catch (e) {
            console.warn(`[OAuth] Failed to fetch ${provider} username:`, e.message);
        }

        res.setHeader('Cross-Origin-Opener-Policy', 'unsafe-none');
        res.send(`
            <html>
                <body style="font-family:sans-serif;text-align:center;padding:50px;background:#0a0a0a;color:#00ff88">
                    <h2>Successfully Connected!</h2>
                    <p>You can close this tab and return to EDITH.</p>
                    <script>
                        try {
                            if (window.opener) {
                                window.opener.postMessage({ type: 'OAUTH_COMPLETE', provider: '${provider}' }, '${FRONTEND_ORIGIN}');
                            }
                        } catch (e) {}
                        setTimeout(() => window.close(), 3000);
                    </script>
                </body>
            </html>
        `);
    } catch (error) {
        console.error('[OAuth Callback] Error:', error);
        res.status(500).send(`Authentication failed: ${error.message}`);
    }
});

// 3. Status
app.get('/api/oauth/status', extractUser, async (req, res) => {
    try {
        const status = await getConnectionStatus(req.user._id);
        res.json(status);
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// 4. Disconnect
app.post('/api/oauth/disconnect/:provider', extractUser, async (req, res) => {
    try {
        const { provider } = req.params;
        await clearTokens(req.user._id, provider);
        clearLLMCacheForUser(req.user._id);
        res.json({ success: true });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// --- API: User Preferences ---
app.put('/api/user/preferences', extractUser, async (req, res) => {
    try {
        const { preferredName, titlePreference } = req.body;

        // Validation
        if (!preferredName || typeof preferredName !== 'string') {
            return res.status(400).json({ error: 'preferredName is required' });
        }
        const trimmedName = preferredName.trim();
        if (trimmedName.length < 2 || trimmedName.length > 20) {
            return res.status(400).json({ error: 'Name must be between 2 and 20 characters' });
        }
        if (!/^[a-zA-Z\s\-']+$/.test(trimmedName)) {
            return res.status(400).json({ error: 'Name can only contain letters, spaces, hyphens, and apostrophes' });
        }
        const validTitles = ['Sir', "Ma'am", 'name'];
        if (!validTitles.includes(titlePreference)) {
            return res.status(400).json({ error: 'Invalid title preference' });
        }

        await User.findByIdAndUpdate(req.user._id, {
            preferredName: trimmedName,
            titlePreference
        });
        res.json({ success: true });
    } catch (error) {
        console.error('[Preferences] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

app.get('/api/user/preferences', extractUser, async (req, res) => {
    try {
        const user = await User.findById(req.user._id).select('preferredName titlePreference');
        res.json({
            preferredName: user?.preferredName || '',
            titlePreference: user?.titlePreference || 'Sir'
        });
    } catch (error) {
        console.error('[Preferences] Error:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- API: Projects ---

// List all projects (auto-seeds General + migrates legacy chat)
app.get('/api/projects', extractUser, async (req, res) => {
    try {
        const userId = req.user._id;
        const count = await Project.countDocuments({ userId });

        if (count === 0) {
            // Auto-seed the default "General" project
            await Project.create({ userId, name: 'General', isDefault: true });
            // Migrate legacy "user-1" chat history to "session-general"
            await Chat.updateMany(
                { userId, sessionId: 'user-1' },
                { $set: { sessionId: 'session-general' } }
            );
            console.log(`[Projects] Auto-seeded General project for user ${req.user.email}`);
        }

        const projects = await Project.find({ userId }).sort({ createdAt: 1 });
        res.json({ projects });
    } catch (error) {
        console.error('[Projects] List error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Get single project
app.get('/api/projects/:id', extractUser, async (req, res) => {
    try {
        const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
        if (!project) return res.status(404).json({ error: 'Project not found' });
        res.json({ project });
    } catch (error) {
        console.error('[Projects] Get error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Create project
app.post('/api/projects', extractUser, async (req, res) => {
    try {
        const { name, jiraProjectKey, githubRepo } = req.body;

        if (!name || name.trim().length < 1 || name.trim().length > 50) {
            return res.status(400).json({ error: 'Project name must be 1-50 characters' });
        }

        if (githubRepo && !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(githubRepo)) {
            return res.status(400).json({ error: 'GitHub repo must be in owner/repo format' });
        }

        if (jiraProjectKey && !/^[A-Z][A-Z0-9_]{1,9}$/.test(jiraProjectKey)) {
            return res.status(400).json({ error: 'Jira project key must be uppercase letters/numbers (2-10 chars)' });
        }

        const project = await Project.create({
            userId: req.user._id,
            name: name.trim(),
            jiraProjectKey: jiraProjectKey || '',
            githubRepo: githubRepo || '',
        });

        res.status(201).json({ project });
    } catch (error) {
        console.error('[Projects] Create error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Update project
app.put('/api/projects/:id', extractUser, async (req, res) => {
    try {
        const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
        if (!project) return res.status(404).json({ error: 'Project not found' });

        const { name, jiraProjectKey, githubRepo } = req.body;

        if (name !== undefined) {
            if (!name || name.trim().length < 1 || name.trim().length > 50) {
                return res.status(400).json({ error: 'Project name must be 1-50 characters' });
            }
            project.name = name.trim();
        }

        if (githubRepo !== undefined) {
            if (githubRepo && !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(githubRepo)) {
                return res.status(400).json({ error: 'GitHub repo must be in owner/repo format' });
            }
            project.githubRepo = githubRepo || '';
        }

        if (jiraProjectKey !== undefined) {
            if (jiraProjectKey && !/^[A-Z][A-Z0-9_]{1,9}$/.test(jiraProjectKey)) {
                return res.status(400).json({ error: 'Jira project key must be uppercase letters/numbers (2-10 chars)' });
            }
            project.jiraProjectKey = jiraProjectKey || '';
        }

        await project.save();
        res.json({ project });
    } catch (error) {
        console.error('[Projects] Update error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Delete project (cannot delete default)
app.delete('/api/projects/:id', extractUser, async (req, res) => {
    try {
        const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
        if (!project) return res.status(404).json({ error: 'Project not found' });
        if (project.isDefault) return res.status(400).json({ error: 'Cannot delete the default project' });

        const sessionId = `project-${project._id}`;
        await Chat.deleteMany({ userId: req.user._id, sessionId });
        await Project.deleteOne({ _id: project._id });

        res.json({ success: true });
    } catch (error) {
        console.error('[Projects] Delete error:', error);
        res.status(500).json({ error: error.message });
    }
});

// GitHub stats for project dashboard
app.get('/api/projects/:id/github-stats', extractUser, async (req, res) => {
    try {
        const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
        if (!project) return res.status(404).json({ error: 'Project not found' });
        if (!project.githubRepo) return res.json({ error: 'no_repo_configured' });

        let token = await getValidToken(req.user._id, 'github');
        let tokenSource = 'oauth';
        if (!token) {
            // Fallback to env PAT (same token the agent uses)
            token = (process.env.GITHUB_TOKEN || process.env.GITHUB_PAT || process.env.GITHUB_PERSONAL_ACCESS_TOKEN || '').trim() || null;
            if (token) tokenSource = 'env_pat';
        }
        console.log(`[Projects] GitHub stats — token source: ${token ? tokenSource : 'NONE'}, repo: ${project.githubRepo}`);
        if (!token) return res.json({ error: 'not_connected' });

        const [owner, repo] = project.githubRepo.split('/');
        const headers = {
            'Authorization': `Bearer ${token}`,
            'Accept': 'application/vnd.github.v3+json',
            'X-GitHub-Api-Version': '2022-11-28',
        };

        // Fetch PRs and issues in parallel
        const [prsRes, issuesRes] = await Promise.all([
            fetch(`https://api.github.com/repos/${owner}/${repo}/pulls?state=all&per_page=100`, { headers }),
            fetch(`https://api.github.com/repos/${owner}/${repo}/issues?state=all&per_page=100`, { headers }),
        ]);

        if (!prsRes.ok || !issuesRes.ok) {
            console.error(`[Projects] GitHub API failed — PRs: ${prsRes.status} ${prsRes.statusText}, Issues: ${issuesRes.status} ${issuesRes.statusText}`);
            return res.status(502).json({ error: 'Failed to fetch GitHub data' });
        }

        const prs = await prsRes.json();
        const allIssues = await issuesRes.json();

        // GitHub API includes PRs in issues — filter them out
        const issues = allIssues.filter(i => !i.pull_request);

        const stats = {
            prs: {
                open: prs.filter(p => p.state === 'open').length,
                closed: prs.filter(p => p.state === 'closed' && !p.merged_at).length,
                merged: prs.filter(p => p.merged_at).length,
            },
            issues: {
                open: issues.filter(i => i.state === 'open').length,
                closed: issues.filter(i => i.state === 'closed').length,
            },
        };

        res.json(stats);
    } catch (error) {
        console.error('[Projects] GitHub stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// Jira stats for project dashboard
app.get('/api/projects/:id/jira-stats', extractUser, async (req, res) => {
    try {
        const project = await Project.findOne({ _id: req.params.id, userId: req.user._id });
        if (!project) return res.status(404).json({ error: 'Project not found' });
        if (!project.jiraProjectKey) return res.json({ error: 'no_key_configured' });

        // Use getValidToken to auto-refresh expired tokens
        const accessToken = await getValidToken(req.user._id, 'jira');
        console.log(`[Projects] Jira stats — token: ${accessToken ? 'obtained' : 'null'}, key: ${project.jiraProjectKey}`);
        if (!accessToken) return res.json({ error: 'not_connected' });

        // Still need stored tokens for cloud_id/cloud_url metadata
        const tokens = await getStoredTokens(req.user._id, 'jira');
        const baseUrl = tokens?.cloud_id
            ? `https://api.atlassian.com/ex/jira/${tokens.cloud_id}`
            : tokens?.cloud_url;

        if (!baseUrl) return res.json({ error: 'not_connected' });

        const jql = encodeURIComponent(`project = "${project.jiraProjectKey}" ORDER BY created DESC`);
        const jiraRes = await fetch(
            `${baseUrl}/rest/api/3/search/jql?jql=${jql}&fields=status&maxResults=100`,
            {
                headers: {
                    'Authorization': `Bearer ${accessToken}`,
                    'Accept': 'application/json',
                },
            }
        );

        if (!jiraRes.ok) {
            const errBody = await jiraRes.text();
            console.error('[Projects] Jira API error:', jiraRes.status, errBody);
            // If 401, the token is invalid/expired even after refresh — prompt re-auth
            if (jiraRes.status === 401) {
                return res.json({ error: 'not_connected' });
            }
            return res.status(502).json({ error: 'Failed to fetch Jira data' });
        }

        const data = await jiraRes.json();
        const statuses = {};
        for (const issue of data.issues || []) {
            const statusName = issue.fields?.status?.name || 'Unknown';
            statuses[statusName] = (statuses[statusName] || 0) + 1;
        }

        res.json({ statuses, total: data.total || 0 });
    } catch (error) {
        console.error('[Projects] Jira stats error:', error);
        res.status(500).json({ error: error.message });
    }
});

// --- API Endpoint ---
app.post('/api/ask', extractUser, async (req, res) => {
  let heartbeatInterval;
  try {
    const { question, files, timezone, voiceEnabled, sessionId: clientSessionId, projectId } = req.body;

    if (!question) {
      return res.status(400).json({ error: 'Question is required' });
    }

    let fullQuestion = question;
    if (files && files.length > 0) {
        const fileList = files.map(f => `- "${f.path}" (${f.originalName})`).join('\n');
        fullQuestion = `The user has attached the following file(s) for you to use. Read them using your file tools before answering:\n${fileList}\n\nUser's message: ${question}`;
        console.log(`[Server] ${files.length} file(s) attached to question`);
    }

    // Resolve project context if a projectId was provided
    let projectContext = null;
    if (projectId) {
        try {
            const project = await Project.findOne({ _id: projectId, userId: req.user._id });
            if (project) {
                projectContext = {
                    jiraProjectKey: project.jiraProjectKey || '',
                    githubRepo: project.githubRepo || '',
                };
            }
        } catch (err) {
            console.warn('[Server] Failed to load project context:', err.message);
        }
    }

    const sessionId = clientSessionId || 'session-general';
    console.log(`[Server] User: ${req.user.email}, Q: ${question} (Timezone: ${timezone || 'UTC'}, Session: ${sessionId})`);

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    // Detect client disconnect to stop processing
    let clientDisconnected = false;

    // Heartbeat to prevent frontend timeout during long tool operations
    heartbeatInterval = setInterval(() => {
        if (!clientDisconnected) {
            try {
                res.write(`data: ${JSON.stringify({ type: "heartbeat" })}\n\n`);
            } catch (e) {
                clearInterval(heartbeatInterval);
            }
        }
    }, 15000);

    req.on('close', () => {
        clientDisconnected = true;
        clearInterval(heartbeatInterval);
        console.log(`[Server] Client disconnected during stream`);
    });

    const userPrefs = { preferredName: req.user.preferredName || '', titlePreference: req.user.titlePreference || 'Sir' };

    // --- /help INTERCEPTOR ---
    if (question.trim().toLowerCase() === '/help') {
        try {
            const status = await getConnectionStatus(req.user._id);
            
            let helpText = "### 🛠️ E.D.I.T.H. Capabilities\nHere are some of the things you can ask me to do based on your current connections:\n\n";
            
            let hasIntegrations = false;
            
            if (status.jira?.connected) {
                hasIntegrations = true;
                helpText += "**Jira**\n- \"Create a new Task called Update README in project FDIT\"\n- \"Create a new project space called ALPHA\"\n- \"Search for bugs assigned to me\"\n- \"Plan a sprint and add issues to it\"\n\n";
            }
            if (status.github?.connected) {
                hasIntegrations = true;
                helpText += "**GitHub**\n- \"Show me my open PRs\"\n- \"Create an issue for the login bug\"\n- \"List recent commits\"\n\n";
            }
            if (status.calendar?.connected) {
                hasIntegrations = true;
                helpText += "**Google Calendar**\n- \"What meetings do I have today?\"\n- \"Schedule a design review for tomorrow at 2pm\"\n\n";
            }
            if (status.gmail?.connected) {
                hasIntegrations = true;
                helpText += "**Gmail**\n- \"Read my recent unread emails\"\n- \"Email John about the project update\"\n\n";
            }
            if (status.slack?.connected) {
                hasIntegrations = true;
                helpText += "**Slack**\n- \"Tell the #dev-team I fixed the login bug\"\n\n";
            }
            if (status.figma?.connected) {
                hasIntegrations = true;
                helpText += "**Figma**\n- \"What are the latest comments on the design file?\"\n\n";
            }
            
            if (!hasIntegrations) {
                helpText += "*You haven't connected any integrations yet!* Click the **Connections** icon (the plug) in the sidebar to link Jira, GitHub, Slack, Figma, Google.\n\n";
            }

            helpText += "**System & Local**\n- \"Open Chrome\"\n- \"Check my CPU and RAM usage\"\n- \"Generate an image of a cybernetic butler\"\n- \"Create a new folder in my Downloads\"";

            res.write(`data: ${JSON.stringify({ type: "token", content: helpText })}\n\n`);
            res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
            clearInterval(heartbeatInterval);
            return res.end();
        } catch (e) {
            console.error('[Server] /help Interceptor Error:', e);
        }
    }
    // --- END /help INTERCEPTOR ---

    const stream = streamWithSemanticRouting(fullQuestion, req.user._id.toString(), timezone, userPrefs, sessionId, projectContext);

    let sentenceBuffer = "";

    // --- Audio Generation Logic (only when voice is enabled) ---
    const ttsPromises = [];

    function generateAudioChunk(text) {
        if (!voiceEnabled) return; // Skip TTS when voice is off
        console.log(`[Server] Triggering TTS for chunk: "${text.substring(0, 40)}..."`);
        const promise = (async () => {
            try {
                console.log(`[Server] Generating speech...`);
                const audioResult = await generateSpeech({ text });
                console.log(`[Server] TTS result type: ${typeof audioResult}, length: ${audioResult ? audioResult.length : 0}`);

                if (typeof audioResult === 'string') {
                    try {
                        const parsed = JSON.parse(audioResult);
                        if (parsed.fallback === 'web-speech-api') {
                            console.log(`[Server] Sending tts_fallback event`);
                            res.write(`data: ${JSON.stringify({ type: "tts_fallback", text: parsed.text })}\n\n`);
                            return;
                        }
                    } catch (e) {}

                    if (audioResult && !audioResult.startsWith("Error")) {
                        console.log(`[Server] Sending audio event (Base64 length: ${audioResult.length})`);
                        res.write(`data: ${JSON.stringify({ type: "audio", url: audioResult })}\n\n`);
                    } else {
                        console.warn(`[Server] TTS returned error string:`, audioResult);
                    }
                }
            } catch (e) { console.error("[Server] TTS Error caught:", e); }
        })();
        ttsPromises.push(promise);
    }

    for await (const event of stream) {
        if (clientDisconnected) break;
        const eventType = event.event;

        if (eventType === "on_chat_model_stream") {
            const content = event.data?.chunk?.content;
            if (content) {
                res.write(`data: ${JSON.stringify({ type: "token", content })}\n\n`);
                sentenceBuffer += content;
                if (/[.?!](\s|$)/.test(sentenceBuffer) && sentenceBuffer.length > 20) {
                    generateAudioChunk(sentenceBuffer.trim());
                    sentenceBuffer = "";
                }
            }
        } else if (eventType === "on_tool_start") {
             res.write(`data: ${JSON.stringify({ type: "tool_start", name: event.name, input: event.data?.input })}\n\n`);
        } else if (eventType === "on_tool_end") {
             const rawOutput = event.data?.output;
             const toolOutput = typeof rawOutput === 'object' && rawOutput !== null
                 ? (rawOutput.content || rawOutput.text || JSON.stringify(rawOutput))
                 : rawOutput;
             res.write(`data: ${JSON.stringify({ type: "tool_end", name: event.name, output: toolOutput })}\n\n`);

             const outputStr = typeof toolOutput === 'string' ? toolOutput : JSON.stringify(toolOutput);
             if (outputStr) {
                 try {
                     const parsed = JSON.parse(outputStr);
                     if (parsed.success && parsed.localUrl && parsed.localUrl.startsWith('/temp/')) {
                                                  res.write(`data: ${JSON.stringify({ type: "image", url: `${process.env.APP_URL}${parsed.localUrl}`, caption: parsed.caption || null })}\n\n`);
                     }
                 } catch (e) { }
             }
        }
    }

    // Send "done" immediately so the frontend unblocks
    res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);

    // Flush remaining TTS and wait for delivery (connection stays open for audio)
    if (voiceEnabled) {
        if (sentenceBuffer.trim().length > 0) {
            generateAudioChunk(sentenceBuffer.trim());
        }
        if (ttsPromises.length > 0) {
            console.log('[TTS] Awaiting TTS queue drain...');
            await Promise.all(ttsPromises);
            console.log('[TTS] Queue drained.');
        }
    }

  } catch (error) {
    console.error("[Server] Ask Error:", error);
    try {
      res.write(`data: ${JSON.stringify({ type: "error", content: error.message })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: "done" })}\n\n`);
    } catch (e) { /* response already closed */ }
  } finally {
    clearInterval(heartbeatInterval);
    res.end();
  }
});

// --- API: Voice Interaction (Streaming SSE) ---
app.post('/api/voice', extractUser, voiceUpload.single('audio'), async (req, res) => {
  try {
    if (!req.file) throw new Error("No audio file uploaded.");

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');

    const base64Audio = req.file.buffer.toString('base64');
    const mimeType = req.file.mimetype || 'audio/webm';

    let userText = await transcribeAudio({ base64Audio, mimeType });
    if (typeof userText === 'string' && userText.startsWith("Error")) throw new Error(userText);

    console.log(`[Voice] User ${req.user.email} said: "${userText}"`);
    res.write(`data: ${JSON.stringify({ type: 'user_text', content: userText })}\n\n`);

    const voiceUserPrefs = { preferredName: req.user.preferredName || '', titlePreference: req.user.titlePreference || 'Sir' };
    const voiceSessionId = req.body?.sessionId || 'session-general';
    let voiceProjectContext = null;
    if (req.body?.projectId) {
        try {
            const project = await Project.findOne({ _id: req.body.projectId, userId: req.user._id });
            if (project) {
                voiceProjectContext = { jiraProjectKey: project.jiraProjectKey || '', githubRepo: project.githubRepo || '' };
            }
        } catch (err) { /* ignore */ }
    }
    const stream = streamWithSemanticRouting(userText, req.user._id.toString(), undefined, voiceUserPrefs, voiceSessionId, voiceProjectContext);
    let sentenceBuffer = "";
    
    // --- Audio Queue System (properly awaited) ---
    const ttsQueue = [];
    let ttsProcessingPromise = null;

    async function processTTSQueue() {
        while (ttsQueue.length > 0) {
            const currentItem = ttsQueue.shift();
            console.log(`[Voice TTS Queue] Generating for: "${currentItem.text.substring(0, 50)}..."`);
            try {
                const audioResult = await generateSpeech({ text: currentItem.text });
                if (typeof audioResult === 'string') {
                    try {
                        const parsed = JSON.parse(audioResult);
                        if (parsed.fallback === 'web-speech-api') {
                            res.write(`data: ${JSON.stringify({ type: "tts_fallback", text: parsed.text })}\n\n`);
                            continue;
                        }
                    } catch (e) {}
                    if (audioResult && !audioResult.startsWith('Error')) {
                        const audioUrl = audioResult.startsWith('data:') ? audioResult : '/temp/' + path.basename(audioResult);
                        res.write(`data: ${JSON.stringify({ type: 'audio', url: audioUrl })}\n\n`);
                    }
                }
            } catch (e) { console.error('[Voice TTS Error]', e); }
        }
    }

    function queueAudioChunk(text) {
        ttsQueue.push({ text });
        if (ttsProcessingPromise) {
            ttsProcessingPromise = ttsProcessingPromise.then(() => processTTSQueue());
        } else {
            ttsProcessingPromise = processTTSQueue();
        }
    }

    for await (const event of stream) {
      const eventType = event.event;
      if (eventType === 'on_chat_model_stream') {
        const content = event.data?.chunk?.content;
        if (content) {
          res.write(`data: ${JSON.stringify({ type: 'token', content })}\n\n`);
          sentenceBuffer += content;
          if (/[.?!](\s|$)/.test(sentenceBuffer) && sentenceBuffer.length > 20) {
            queueAudioChunk(sentenceBuffer.trim());
            sentenceBuffer = '';
          }
        }
      } else if (eventType === 'on_tool_start') {
        res.write(`data: ${JSON.stringify({ type: 'tool_start', name: event.name, input: event.data?.input })}\n\n`);
      } else if (eventType === 'on_tool_end') {
        const rawOutput = event.data?.output;
        const toolOutput = typeof rawOutput === 'object' && rawOutput !== null
          ? (rawOutput.content || rawOutput.text || JSON.stringify(rawOutput))
          : rawOutput;
        res.write(`data: ${JSON.stringify({ type: 'tool_end', name: event.name, output: toolOutput })}\n\n`);
      }
    }

    // Send "done" immediately so the frontend unblocks
    res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);

    // Flush remaining TTS and wait for delivery (connection stays open for audio)
    if (sentenceBuffer.trim().length > 0) {
      queueAudioChunk(sentenceBuffer.trim());
    }
    if (ttsProcessingPromise) {
        await ttsProcessingPromise;
    }

  } catch (error) {
    console.error('[Voice Error]', error);
    try {
      res.write(`data: ${JSON.stringify({ type: 'error', content: error.message })}\n\n`);
      res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
    } catch (e) { /* response already closed */ }
  } finally {
    try { res.end(); } catch (e) { }
  }
});

// --- API: Chat History ---
app.get('/api/history', extractUser, async (req, res) => {
    try {
        const sessionId = req.query.sessionId || 'session-general';
        const offset = parseInt(req.query.offset) || 0;
        const limit = parseInt(req.query.limit) || 20;

        const chat = await Chat.findOne({ userId: req.user._id, sessionId });
        if (!chat) return res.json({ messages: [], total: 0, hasMore: false });

        const total = chat.messages.length;
        const start = Math.max(0, total - offset - limit);
        const end = Math.max(0, total - offset);
        const slice = chat.messages.slice(start, end);
        
        res.json({ messages: slice, total, hasMore: start > 0 });
    } catch (error) {
        console.error('[History Error]', error);
        res.status(500).json({ error: error.message });
    }
});

// --- NEW API: Deepgram WebSocket Proxy ---
import { WebSocketServer, WebSocket } from 'ws';
const wss = new WebSocketServer({ noServer: true });
wss.on('connection', (ws) => {
    let deepgramWs = null;
    if (!process.env.DEEPGRAM_API_KEY) { ws.close(); return; }
    try {
        deepgramWs = new WebSocket('wss://api.deepgram.com/v1/listen?model=nova-2&punctuate=true&interim_results=true', {
            headers: { Authorization: `Token ${process.env.DEEPGRAM_API_KEY}` }
        });
        deepgramWs.on('open', () => ws.send(JSON.stringify({ type: 'ready' })));
        deepgramWs.on('message', (data) => {
            try {
               const parsed = JSON.parse(data);
               if (parsed.channel?.alternatives?.[0]) {
                   const transcript = parsed.channel.alternatives[0].transcript;
                   if (transcript) ws.send(JSON.stringify({ type: 'transcript', isFinal: parsed.is_final, text: transcript }));
               }
            } catch (e) { }
        });
        deepgramWs.on('close', () => ws.close());
        deepgramWs.on('error', () => ws.close());
    } catch(err) { ws.close(); }
    ws.on('message', (message) => { if (deepgramWs?.readyState === WebSocket.OPEN) deepgramWs.send(message); });
    ws.on('close', () => { if (deepgramWs?.readyState === WebSocket.OPEN) deepgramWs.close(); });
});

// --- SPA Fallback: serve index.html for all non-API routes ---
const frontendIndex = path.join(__dirname, 'frontend', 'dist', 'index.html');
app.use((req, res) => {
    if (fs.existsSync(frontendIndex)) {
        res.sendFile(frontendIndex);
    } else {
        res.status(404).send('Frontend not built. Run: npm run build');
    }
});

// --- Start Server ---
const frontendDistPath = path.join(__dirname, 'frontend', 'dist');
const server = app.listen(port, () => {
    console.log(`Server is listening at http://localhost:${port}`);
    console.log(`[Static] Serving frontend from: ${frontendDistPath}`);
    console.log(`[Static] index.html exists: ${fs.existsSync(path.join(frontendDistPath, 'index.html'))}`);
});
server.on('error', (e) => {
    if (e.code === 'EADDRINUSE') {
        console.error(`\n[CRITICAL] Port ${port} is already in use!`);
        console.error(`[CRITICAL] Another instance of EDITH or node is likely running.`);
        console.error(`[CRITICAL] Please kill the zombie process and restart.\n`);
        process.exit(1);
    } else {
        console.error('[CRITICAL] Server error:', e);
    }
});
server.on('upgrade', (request, socket, head) => {
  if (request.url === '/api/live-transcription') {
    wss.handleUpgrade(request, socket, head, (ws) => wss.emit('connection', ws, request));
  } else { socket.destroy(); }
});
setInterval(() => console.log('[Heartbeat] Server is alive...'), 300000);
process.on('uncaughtException', (err) => console.error('[CRITICAL] Uncaught Exception:', err));
process.on('SIGINT', () => process.exit(0));
process.on('unhandledRejection', (reason, promise) => console.error('[CRITICAL] Unhandled Rejection at:', promise, 'reason:', reason));
