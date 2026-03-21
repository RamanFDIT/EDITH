# EDITH Core - Capstone

## Project Overview

EDITH (Enhanced Digital Intelligence & Task Handler) is an Electron-based AI assistant app that uses LangGraph agents backed by multiple LLM providers (GitHub Models, Gemini, Ollama). It integrates with Google Calendar, Gmail, and other services via OAuth.

## Architecture

- **Frontend**: Web UI (built before packaging via `predist` script)
- **Backend**: Node.js (ES Modules) running inside Electron
- **Entry point**: `electron-main.cjs` (CJS bootstrap) → `main.js` (Electron main process)
- **Agent**: `agent.js` — LangGraph-based agent with intent classification and multi-tool support
- **OAuth**: `oauthService.js` — Token encryption/decryption, OAuth flows for Google & GitHub
- **Database**: `db.js` — User model for storing credentials and user preferences
- **System Prompt**: `systemPrompt.js` — Builds the EDITH persona system prompt with dynamic user designation
- **Config**: `store.js` (electron-store defaults), `bundledConfig.js` (OAuth client IDs)

## LLM Provider Setup

Priority order (configured via `LLM_PROVIDER` env var, default `auto`):

1. **GitHub Models** — Uses `ChatOpenAI` pointed at `https://models.github.ai/inference`. Auth via `GITHUB_TOKEN` (user's GitHub OAuth token). Models: `gpt-4o` (main), `gpt-4o-mini` (classifier).
2. **Gemini** — Uses `ChatGoogleGenerativeAI` with `GEMINI_API_KEY`. API key auth only (OAuth doesn't work for Gemini `generateContent`).
3. **Ollama** — Local fallback via `ChatOllama`.

LLM instances are cached per user+provider with a 5-minute TTL to avoid re-creation on every message.

## Key Design Decisions

### ENCRYPTION_KEY auto-generation (2026-03-19)

**Problem**: `oauthService.js` used a hardcoded fallback encryption key when `ENCRYPTION_KEY` wasn't set in `.env`. This caused a `[SECURITY WARNING]` on every startup and meant all installations shared the same key for OAuth token encryption — a real security risk.

**Solution**: `getValidKey()` now auto-generates a random 32-byte hex key on first run using `crypto.randomBytes(32)`, appends it to `.env`, and sets it on `process.env`. On subsequent startups, `dotenv` loads it normally — no warning, no generation. Each deployment gets a unique key automatically.

**Important**: If you ever need to reset the encryption key, be aware that all previously encrypted OAuth tokens in the database will become unreadable. Users would need to re-authenticate.

### LLM instance caching (2026-03-19)

**Problem**: `getLLMForUser()` was creating new `ChatOpenAI`/`ChatGoogleGenerativeAI` instances on every single message, adding unnecessary overhead.

**Solution**: Added a `Map`-based cache keyed by `userId:provider` with a 5-minute TTL. Cache hits skip all provider detection and instance creation logic.

### Removed GitHub Models health-check (2026-03-19)

**Problem**: Every call to `getLLMForUser()` made a throwaway API call to GitHub Models to verify the token worked. This added latency to every user message and consumed rate-limited API calls (free tier: 50-150 req/day).

**Solution**: Removed the health-check entirely. If the token is invalid, the actual LLM call will fail with a clear error — no need to pre-check.

### OAuth status fetch on mount (2026-03-19)

**Problem**: Connected OAuth tools (Google, GitHub) appeared disconnected in the NavBar after page reload. `oauthStatus` in `AppContext` initialized as `{}` with no auto-fetch on mount — the only fetch was in NavBar's `useEffect`, which ran after the first render with empty status.

**Solution**: Added a `useEffect` in `AppContext.jsx` that calls `refreshOauthStatus()` on mount (keyed on the memoized callback). This pre-populates OAuth status for all consumers before they render. Removed the now-redundant `useEffect` and `useEffect` import from `NavBar.jsx` to avoid a duplicate API call.

**Files changed**: `frontend/src/context/AppContext.jsx`, `frontend/src/components/NavBar/NavBar.jsx`

### OAuth status persistence in localStorage (2026-03-19)

**Problem**: After page reload, NavBar and Settings showed all services as disconnected even though tokens were valid in the database. `oauthStatus` in `AppContext` initialized as `{}` on every mount and the async fetch took time, causing a flash of empty state. Additionally, `Settings.jsx` declared its own local `oauthStatus` state that shadowed AppContext's value, so even after AppContext fetched the data, Settings never saw it.

**Solution**: Three-part fix:

1. **AppContext** (`frontend/src/context/AppContext.jsx`): `oauthStatus` now initializes from `localStorage('edith_oauth_status')` and `refreshOauthStatus()` writes to localStorage after each successful fetch. This provides an instant cached snapshot on reload while the fresh API call is in-flight.
2. **Settings** (`frontend/src/Pages/Settings/Settings.jsx`): Removed the local `oauthStatus` shadow state and its duplicate `useEffect` fetch. Now reads `oauthStatus` directly from `useApp()`. Connect/disconnect actions call `refreshOauthStatus()` which updates shared AppContext state + localStorage.
3. **ConnectionPage** (`frontend/src/Pages/ConnectionPage/ConnectionPage.jsx`): Seeds local `connectionStatus` from AppContext's `oauthStatus` on mount, so already-connected tools show correctly if the user navigates back.

**Files changed**: `frontend/src/context/AppContext.jsx`, `frontend/src/Pages/Settings/Settings.jsx`, `frontend/src/Pages/ConnectionPage/ConnectionPage.jsx`

### Intent classification threshold (2026-03-19)

The short-query threshold for skipping LLM-based intent classification was bumped from 5 words to 8 words. Queries under 8 words now default to `general` intent without calling the classifier, reducing unnecessary API calls.

### User preferences & personalized addressing (2026-03-19)

**Problem**: The system prompt hardcoded `USER DESIGNATION: "Sir", "Ma'am", or [User's Title]` — EDITH never actually personalized how it addressed the user.

**Solution**: Added user preference fields and an end-to-end flow for personalized addressing:

1. **User model** (`db.js`): Added `preferredName` (String) and `titlePreference` (enum: `'Sir'`, `'Ma'am'`, `'name'`, default `'Sir'`).
2. **API** (`server.js`): New `PUT /api/user/preferences` (with server-side validation: length 2-20, alpha/space/hyphen/apostrophe regex, valid enum) and `GET /api/user/preferences`. Both `/api/ask` and `/api/voice` extract `userPrefs` from `req.user` and pass them downstream.
3. **System prompt** (`systemPrompt.js`): `buildSystemPrompt(userTimezone, userPrefs)` and `getSystemPrompt(userTimezone, userPrefs)` now accept a second `userPrefs` parameter. The `USER DESIGNATION` line is dynamic — shows the title or the name depending on preference. A `USER NAME` line is injected so EDITH always knows the user's name regardless of title choice.
4. **Agent** (`agent.js`): `streamWithSemanticRouting(query, userId, timezone, userPrefs)` accepts a 4th parameter. `getOrCreateAgent(tools, tz, userId, llm, userPrefs)` accepts a 5th. Both `getSystemPrompt()` call sites (general path and agent path) pass `userPrefs` through.
5. **Frontend context** (`AppContext.jsx`): Added `preferredName` and `titlePreference` state (persisted to localStorage). Added `updateUserPreferences(name, title)` — updates state, localStorage, and calls `PUT /api/user/preferences`.
6. **Profanity filter** (`frontend/src/utils/profanityFilter.js`): `validateName(text)` checks empty, length 2-20, character regex, and a ~70-word profanity blocklist. `containsProfanity(text)` does case-insensitive word-boundary matching.

**Current flow**: Preferences are managed in the Settings page (see "User preferences moved to Settings" below). The original `/user-setup` onboarding page was removed from routing.

**Files changed**: `db.js`, `server.js`, `systemPrompt.js`, `agent.js`, `frontend/src/context/AppContext.jsx`, `frontend/src/App.jsx`, `frontend/src/Pages/Intro/Intro.jsx`

**Files created**: `frontend/src/Pages/UserSetup/UserSetup.jsx`, `frontend/src/Pages/UserSetup/UserSetup.module.css`, `frontend/src/utils/profanityFilter.js`

### Simplified auth flow (2026-03-20)

**Problem**: Multi-step onboarding (Intro → UserSetup → Onboarding → ConnectionPage → Home) was confusing, and Google's unverified app warning scared users away during sign-in.

**Solution**: Email/password as primary auth (using `bcryptjs` for hashing), Google OAuth as secondary. Simplified flow: `/` (Intro) → `/auth` → `/home`. Added `POST /api/auth/register` and `POST /api/auth/login` endpoints to `server.js`. Added `password` field to User schema in `db.js`. Auth page supports both registration and login with toggle.

**Files changed**: `db.js`, `server.js`, `frontend/src/App.jsx`, `frontend/src/Pages/Intro/Intro.jsx`, `frontend/src/context/AppContext.jsx`, `frontend/src/components/Navigation/ProtectedRoute.jsx`, `frontend/src/components/Navigation/PublicOnlyRoute.jsx`

**Files created**: `frontend/src/Pages/Auth/Auth.jsx`, `frontend/src/Pages/Auth/Auth.module.css`

**Dependency added**: `bcryptjs`

### User preferences moved to Settings (2026-03-20)

**Problem**: The `/user-setup` onboarding page was removed from the routing flow, so there was no UI for setting preferred name / title preference.

**Solution**: Added a Preferences section to the Settings page with name input, title radio buttons (Sir / Ma'am / Just my name), and a Save button. Settings page now fetches current preferences on mount and uses `updateUserPreferences()` from AppContext.

**Files changed**: `frontend/src/Pages/Settings/Settings.jsx`, `frontend/src/Pages/Settings/Settings.module.css`

### Thinking indicator & voice default OFF (2026-03-20)

- Voice output now defaults to OFF for new installs (less surprising UX).
- Added `isThinking` state with animated pulsing dots bubble that displays between message submit and first streamed token, giving visual feedback that the AI is processing.

**Files changed**: `frontend/src/Pages/Home/Home.jsx`, `frontend/src/Pages/Home/Home.module.css`

## Build & Run

```bash
# Install dependencies (--legacy-peer-deps required due to peer conflicts)
npm install --legacy-peer-deps

# Dev mode
npm run dev

# Build Windows installer (NSIS)
npm run dist
```

- Target: Windows NSIS installer
- App ID: `com.raman.edith`
- `npm run dist` runs `predist` first to build the frontend
- `bcryptjs` is a runtime dependency (used for email/password auth hashing)

## Environment Variables (.env)

| Variable | Required | Description |
|---|---|---|
| `ENCRYPTION_KEY` | Auto-generated | 64-char hex key for OAuth token encryption. Created automatically on first run if missing. |
| `LLM_PROVIDER` | No | `auto` (default), `github`, `gemini`, or `ollama` |
| `GITHUB_TOKEN` | For GitHub Models | GitHub OAuth token |
| `GITHUB_MODEL` | No | Default: `gpt-4o` |
| `GEMINI_API_KEY` | For Gemini | Gemini API key (not OAuth) |
| `OLLAMA_BASE_URL` | For Ollama | Default: `http://localhost:11434` |
| `OLLAMA_MODEL` | For Ollama | Default: `llama3` |

## Gotchas

- **Gemini OAuth doesn't work**: The `generative-language` OAuth scope doesn't exist. `cloud-platform` scope requires a Google security audit. Use API key auth only.
- **BrowserWindow import in oauthService**: Must be lazily imported inside functions, not at module level — packaged Electron apps crash otherwise (Electron not ready at import time).
- **Token encryption is key-dependent**: Changing or losing `ENCRYPTION_KEY` invalidates all stored OAuth tokens. Users must re-authenticate.
- **`--legacy-peer-deps`**: Always use this flag with `npm install` due to dependency conflicts.
- **User preferences are dual-stored**: `preferredName` and `titlePreference` live in both localStorage (for instant frontend access) and MongoDB (for backend system prompt injection). The Settings page fetches from `GET /api/user/preferences` on mount to reconcile. If localStorage is cleared, Settings will re-sync from the DB on next visit.
- **Email/password auth coexists with Google OAuth**: Passwords are bcrypt-hashed in the User model. Google-only users have `password: null`. Both auth methods share the same User document — a user who registered with email can later connect Google OAuth, and vice versa.
- **Removed onboarding pages still exist on disk**: `UserSetup`, `Onboarding`, and `ConnectionPage` files remain in the codebase but are not routed in `App.jsx` — kept as reference. They can be safely deleted if no longer needed.
- **OAuth status is cached in localStorage**: `edith_oauth_status` in localStorage provides instant UI on reload. The cache is refreshed from the API on every mount and after every connect/disconnect action. Clearing localStorage will cause a brief flash of "disconnected" until the API fetch completes — this is cosmetic only, tokens remain valid in the DB.
