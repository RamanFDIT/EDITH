# EDITH Core - Capstone

## Project Overview

EDITH (Enhanced Digital Intelligence & Task Handler) is an Electron-based AI assistant app that uses LangGraph agents backed by multiple LLM providers (GitHub Models, Gemini, Ollama). It integrates with Google Calendar, Gmail, and other services via OAuth.

## Architecture

- **Frontend**: Web UI (built before packaging via `predist` script)
- **Backend**: Node.js (ES Modules) running inside Electron
- **Entry point**: `electron-main.cjs` (CJS bootstrap) → `main.js` (Electron main process)
- **Agent**: `agent.js` — LangGraph-based agent with intent classification and multi-tool support
- **OAuth**: `oauthService.js` — Token encryption/decryption, OAuth flows for Google & GitHub
- **Database**: `db.js` — User model for storing credentials
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

### Intent classification threshold (2026-03-19)

The short-query threshold for skipping LLM-based intent classification was bumped from 5 words to 8 words. Queries under 8 words now default to `general` intent without calling the classifier, reducing unnecessary API calls.

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
