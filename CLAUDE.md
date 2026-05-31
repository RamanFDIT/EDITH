# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Build & Run Commands

```bash
# Install dependencies (--legacy-peer-deps REQUIRED due to peer conflicts)
npm install --legacy-peer-deps
cd frontend && npm install --legacy-peer-deps

# Development (run both in separate terminals)
npm run dev:backend              # node --watch server.js (port 3000)
cd frontend && npm run dev       # Vite dev server (port 5173)

# Production build
npm run build                    # Builds frontend to frontend/dist
npm start                        # Serves built frontend + API on port 3000

# Frontend lint
cd frontend && npm run lint
```

There are no tests in this project.

## Architecture Overview

EDITH (Even Dead I'm The Hero) is a web-based AI assistant with a React frontend and Express/Node.js backend, backed by MongoDB.

### Backend (root directory, ES Modules)

- **`server.js`** — Express API server. Handles auth (email/password + Google OAuth), SSE streaming for chat, OAuth tool connections, project CRUD, file uploads. User identity flows through `X-User-Email` header on every request.
- **`agent.js`** — LangGraph agent with all 36 tools given to the LLM on every request. Selects LLM provider (Gemini 3 Flash → GitHub Models → Ollama) with instance caching (5min TTL). Blocked providers tracked for 30min per user.
- **`oauthService.js`** — OAuth flows for Google, GitHub, Slack, Figma, Jira. Token encryption (AES-256-CBC), auto-refresh, and auto-generation of `ENCRYPTION_KEY` (persisted to MongoDB AppConfig).
- **`db.js`** — Mongoose schemas: `User` (auth, encrypted tokens, preferences, settings), `Chat` (session-scoped message history), `Project` (name, jiraProjectKey, githubRepo).
- **`systemPrompt.js`** — Builds the EDITH persona prompt dynamically with user timezone, preferred name, and title preference.
- **Tool files** (`calendarTool.js`, `gmailTool.js`, `githubTool.js`, `jiraTool.js`, `slackTool.js`, `figmaTool.js`, `imageTool.js`, `audioTool.js`, `fileTool.js`) — LangGraph-compatible tools, each wrapping external APIs using OAuth tokens from the user's DB record.

### Frontend (`frontend/`, React 19 + Vite + Tailwind)

- **`src/App.jsx`** — HashRouter with route guards. `PublicOnlyRoute` (redirects authenticated users to `/home`), `ProtectedRoute` (redirects unauthenticated to `/`). NavBar hidden on auth routes.
- **`src/context/AppContext.jsx`** — Global state provider: auth state, OAuth status, projects, user preferences, chat messages. State is dual-stored in localStorage (instant UI) and MongoDB (source of truth), synced on mount.
- **`src/apiConfig.js`** — API URL: `localhost:3000` in dev, `https://edith-4ihs.onrender.com` in prod. Override with `VITE_API_URL`.

### Key Pages

| Route | Component | Purpose |
|-------|-----------|---------|
| `/` | Intro | Landing page |
| `/auth` | Auth | Email/password + Google OAuth sign-in |
| `/auth/callback` | AuthCallback | Handles Google OAuth redirect |
| `/home` | HomeRedirect | Redirects to active project's chat/dashboard |
| `/project/:id` | ProjectDashboard | Project stats, GitHub/Jira integration |
| `/project/:id/chat` | Home | Main chat interface (SSE streaming, voice, history) |
| `/settings` | Settings | OAuth tool connections, user preferences |

## Auth Flow

**Email/password**: `POST /api/auth/register` or `POST /api/auth/login` → bcryptjs hash/compare → return user data → frontend stores email in localStorage.

**Google OAuth**: Redirect-based (not popup). `GET /api/auth/google` returns Google OAuth URL → browser redirects to Google → callback at `/api/oauth/callback` → server redirects to `/#/auth/callback?email=...&name=...` → `AuthCallback.jsx` reads params, sets auth state, navigates to `/home`.

**Session validation**: On mount, `AppContext` calls `GET /api/auth/session` with stored email. Invalid sessions clear localStorage.

## Streaming (SSE) Protocol

`POST /api/ask` returns `text/event-stream` with double-newline-separated JSON events:
- `{ type: "token", content: "..." }` — LLM text chunk
- `{ type: "tool_start", name: "...", input: {...} }` — Tool invocation
- `{ type: "tool_end", name: "...", output: "..." }` — Tool result
- `{ type: "image", url: "...", caption: "..." }` — Generated image
- `{ type: "audio", url: "data:audio/..." }` — TTS audio (base64)
- `{ type: "heartbeat" }` — Keep-alive during long tool operations (every 15s)
- `{ type: "done" }` — Stream complete

`POST /api/voice` accepts a multipart audio file upload, transcribes it, then streams the same SSE event types plus `{ type: "user_text", content: "..." }` with the transcription.

## LLM Provider Priority

1. **Gemini** — `ChatGoogleGenerativeAI` with `GOOGLE_API_KEY` (`gemini-3-flash-preview`). API key only (OAuth doesn't work for Gemini `generateContent`).
2. **GitHub Models** — `ChatOpenAI` with `baseURL: https://models.github.ai/inference`. Uses user's GitHub OAuth token. Model: `gpt-4o` (main).
3. **Ollama** — Local fallback via `ChatOllama`.

## Tool Routing

All 36 tools are given to the LLM on every request — no intent classification or keyword-based routing. The LLM picks which tools to call based on conversation context naturally. Confirmation detection (`isConfirmationMessage`) is still used to inject a CONTINUATION or FRESHNESS GUARD prompt nudge, but it does not affect tool selection.

## Voice / STT / TTS Pipeline

Audio flows through multiple systems across frontend and backend:

**Speech-to-Text (frontend capture):**
- `Input.jsx` records via MediaRecorder (`audio/webm`), with silence detection (AudioContext frequency analysis, auto-stops after 2s silence).
- The recorded blob is posted as multipart form data to `/api/voice`; no in-browser model runs.

**Speech-to-Text (server-side, `/api/voice`):**
- `POST /api/voice` receives the multipart audio, transcribes via `audioTool.js` using Gemini `generateContent()` with audio data.
- Returns `{ type: "user_text" }` SSE event with transcription, then streams the normal response.

**Text-to-Speech (server-side):**
- Priority: Edge TTS (Microsoft neural voices, free) → ElevenLabs (API key) → `tts_fallback` event (browser Web Speech API).
- TTS queue in `server.js` processes sentences sequentially to prevent reordering. Sentences split on `.?!` with 20+ char minimum.
- Returns `{ type: "audio", url: "data:audio/..." }` (base64) or `{ type: "tts_fallback", text: "..." }`.

**Audio playback (frontend):**
- `Home.jsx` maintains a sequential playback queue. URL audio plays via `<audio>` element; fallback uses `SpeechSynthesisUtterance`. Respects voice toggle.

## History Sanitization

`agent.js` filters chat history before sending to LLM (4 levels):
1. **Human messages** — never pruned.
2. **Age-based** — keeps only last 10 messages (5 exchanges).
3. **Failure patterns** — strips AI messages matching 20+ regex patterns (Slack errors, Jira deprecation notices, repeated failure admissions) to prevent the LLM from "learning" that tools always fail.
4. **Heavy data** — messages >2000 chars truncated to 1500 + `[... CONTENT TRUNCATED ...]`.

## LLM Instance Caching & Provider Blocking

- **Cache**: In-memory `Map` keyed by `${userId}:${provider}:${excludedProviders}`. TTL: 5 minutes. Cleanup every 10 minutes.
- **Blocked providers**: Per-user `Map` tracking providers that returned 403. TTL: 30 minutes. Prevents repeated auth attempts on expired tokens.

## Key Design Decisions

### ENCRYPTION_KEY auto-generation
`oauthService.js` auto-generates a random 32-byte hex key on first run if missing. Stored in MongoDB `AppConfig` collection (survives Render redeploys). Changing the key invalidates all stored OAuth tokens.

**Key resolution precedence** (`ensureEncryptionKey`, oauthService.js:34): `process.env.ENCRYPTION_KEY` (from `.env`) **wins over** the AppConfig DB value. If unset, it loads from AppConfig; if that's empty, it generates a new one. Consequence: a local `.env` with its own `ENCRYPTION_KEY` will *shadow* the shared AppConfig key and be unable to decrypt tokens that another server (e.g. Render production) encrypted. `.env` is gitignored and **not** deployed to Render, so production uses the AppConfig key. To make a local server decrypt the same tokens as production, leave `ENCRYPTION_KEY` unset in local `.env` so it falls back to the shared AppConfig key.

**Connected status = decryptability** (`getConnectionStatus`, oauthService.js:327-329): a provider shows `connected: true` only if its stored `access_token` *decrypts* with the current key — not merely if a token exists. **Orphaned tokens**: if the key was ever regenerated, all previously stored tokens become permanently undecryptable (the old key is gone) and every integration reports offline. The fix is **not** to hunt for the old key — it's to **reconnect the tools** (re-OAuth via the web Settings page), which re-encrypts fresh tokens with the current key.

### Dual storage pattern
User preferences and OAuth status live in both localStorage (instant frontend render) and MongoDB (persistent). `AppContext` initializes from localStorage, then syncs from API on mount.

### Project-scoped chat sessions
Each project has a `sessionId` (`session-general` for default, `project-<id>` for others). Chat history is tied to sessionId. Switching projects resets messages and re-fetches history.

### OAuth tool connections vs auth sign-in
Google OAuth sign-in (basic scopes: openid, email, profile) is separate from tool connections (Calendar, Gmail scopes). Tool connections use a popup + `postMessage` pattern from Settings page. Auth sign-in uses a full-page redirect flow.

## Gotchas

- **`--legacy-peer-deps`**: Always required for `npm install`.
- **SSE inactivity timeout**: Frontend aborts stream after 60s of no data. Heartbeats (every 15s) prevent this during long tool operations. If adding new long-running tools, ensure the heartbeat interval is active.
- **Gemini OAuth doesn't work**: No valid OAuth scope for `generateContent`. Use API key only.
- **Token encryption is key-dependent**: Losing `ENCRYPTION_KEY` invalidates all stored tokens. Key is persisted in MongoDB AppConfig, not just .env.
- **`extractUser` middleware** (`server.js`): Resolves user identity via `X-User-Email` header (preferred) or `X-User-ID` query param (legacy UUID → `${uuid}@edith.local`). Auto-creates User docs for unknown identifiers. Returns 401 if neither provided.
- **Removed pages still on disk**: `UserSetup`, `Onboarding`, `ConnectionPage` exist but aren't routed. Safe to delete.
- **CORS origins**: `server.js` line 38 defines `FRONTEND_ORIGIN` (default `http://localhost:5173`). Production uses Render URL. Both must match for OAuth callbacks and API calls.
- **Production URL**: Backend deployed to `https://edith-4ihs.onrender.com`. Frontend apiConfig auto-detects dev vs prod.

## VS Code Extension (`edith-vscode/`)

The extension is a chat client that talks to the same backend as the web app. It has **no connections UI of its own** — OAuth tools are connected via the web Settings page and shared through the DB by email.

- **Server target**: `edith.apiUrl` VS Code setting (default `https://edith-4ihs.onrender.com`, see `credentials.ts:9`). Set to `http://localhost:3000` to hit a local dev server.
- **Identity**: stored email in VS Code SecretStorage, sent as `X-User-Email` (credentials.ts). Must match the web login email exactly — `extractUser` auto-creates an empty user for any unseen email, which then shows zero connections.
- **"Tools offline" / "not connected"** is EDITH's own reply from `getConnectionStatus` — it means tokens didn't decrypt (see ENCRYPTION_KEY notes above), **not** that the email or server is wrong.
- **vscode-webview CORS**: the extension webview fetches from a `vscode-webview://<guid>` origin. `server.js` CORS must allow it (regex at the `cors()` origin callback, ~line 111). This fix is required on whatever server the extension targets.
- **Testing checklist (catch-22 to watch for)**: local server has the latest IDE features + CORS fix but may use a shadowing `.env` key; production has the right shared key but only whatever's on the deployed branch. To test the extension end-to-end against **local**: (1) ensure `server.js` has the vscode-webview CORS rule, (2) unset `ENCRYPTION_KEY` in local `.env` so it shares production's AppConfig key, (3) reconnect tools on the web app, (4) point `edith.apiUrl` at `localhost:3000`.
