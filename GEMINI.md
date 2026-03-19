# Gemini Context: EDITH Core - Tactical Assistant

## 🚀 Project Overview
EDITH (Even Dead I'm The Hero) is a sophisticated local AI assistant designed for developer productivity and system control. It's an Electron-based desktop application that integrates with various development and productivity tools through a "Jarvis-like" tactical interface.

## 🏗 Architecture & Core Components
- **Main App**: Electron (`electron-main.cjs`, `main.js`, `preload.js`)
- **Backend Service**: Node.js/Express (`server.js`, `app.js`)
- **AI Core**: LangChain/LangGraph agent (`agent.js`)
- **LLM Support**:
    - **GitHub Models**: GPT-4o/GPT-4o-mini (via GitHub App OAuth)
    - **Gemini API**: Gemini 2.5 Flash / 2.0 Flash Lite (via Server-Side GOOGLE_API_KEY)
    - **Ollama**: Local models (Llama 3.2, etc.) for zero-API key operation.
- **Frontend**: React (Vite, Tailwind CSS 4, Lucide React) in `frontend/`.
- **Website**: Marketing site in `frontend-website/`.

## 🛠 Integrated Toolsets
- **Dev Tools**: 
    - `githubTool.js`: Repos, Issues, Commits, PRs.
    - `jiraTool.js`: Project & Issue management (JQL support).
    - `figmaTool.js`: File structure scanning, comment posting.
- **System Control** (`systemTool.js`):
    - System status monitoring (CPU, RAM).
    - Terminal command execution (direct shell access).
    - App launcher (Open Chrome, Spotify, etc.).
- **Productivity**:
    - `calendarTool.js`: Google Calendar (Events, Free time finder).
    - `gmailTool.js`: Send/Search emails and contacts.
    - `slackTool.js`: Messages, announcements, and links.
- **Multi-modal/Media**:
    - `imageTool.js`: Image generation via Gemini 2.5 Flash ("Nano Banana").
    - `audioTool.js`: Voice integration (ElevenLabs, Deepgram).
    - `fileTool.js`: Local file system interaction (Read, List).

## 🎨 UI & Design Standards
- **Stack**: React 19, Tailwind CSS 4, Lucide React icons.
- **Interface**: "Tactical Assistant" aesthetic (dark mode, futuristic accents).
- **Communication**: Real-time updates via WebSockets (`ws`).

## ⚙️ Key Logic
- **`agent.js`**: Orchestrates LangChain tools and manages LLM provider selection (Auto/GitHub/Gemini/Ollama).
- **`oauthService.js`**: Manages OAuth2 tokens for Google (Calendar, Gmail) and GitHub. Includes AES-256-CBC encryption for tokens at rest.
- **`systemPrompt.js`**: Contains the complex instruction set for EDITH's personality and operational guidelines.
- **`envConfig.js`**: Handles local and global (`~/.edith.env`) environment variables for portability.

## 📦 Deployment
- **Packager**: `electron-builder`
- **Portability**: Supports "Safe Mode" where users can provide their own `.edith.env` for API keys.

## 🔒 Authentication Constraint
**Constraint:** Implement ONLY those changes that do not require the end user to go fetch their personal API keys. LLM integrations must rely on standard OAuth connections or server-side global keys. Features that rely on users supplying Personal Access Tokens (PATs) or manual API keys must be avoided.

## 🔍 Codebase Analysis & Recent Changes

### 1. Fixed 401 "Bad Credentials" Error (GitHub Models)
- **Issue:** Standard GitHub OAuth tokens (`ghu_...`) were rejected by the Azure Inference endpoint (`models.inference.ai.azure.com`).
- **Fix:** Switched the GitHub Models `baseURL` to the official GitHub API proxy (`https://models.github.ai/inference`).
- **Dependency:** Migrated from a GitHub "OAuth App" to a **GitHub App** with the specific `models:read` permission enabled. This allows standard user tokens to authenticate for free LLM access (150 requests/day).

### 2. Fixed Google OAuth LLM Failure
- **Discovery:** Using the user's Google OAuth token for Gemini requires the `generative-language` scope, which breaks the login flow unless the Google Cloud App is verified.
- **Resolution:** Reverted Google OAuth scopes to standard (Calendar/Gmail) and configured the backend to use the server's global `GOOGLE_API_KEY` as a fallback. This keeps the experience free and key-less for the end-user.

### 3. Token Encryption (AES-256-CBC)
- **Security:** Implemented transparent encryption for all OAuth tokens stored in MongoDB.
- **Logic:** Tokens are encrypted in `storeTokens` and decrypted in `getStoredTokens` using a server-side `ENCRYPTION_KEY`.
- **Integrity:** `getConnectionStatus` now validates tokens by attempting decryption, ensuring the UI accurately reflects connection status even if the encryption key changes.

### 4. Code Robustness & Null Safety
- **Issue:** `TypeError: Cannot read properties of undefined (reading 'replace')` was crashing the chat interface.
- **Fixes:** 
    - Applied null-guards `(message || '')` across `ChatAI.jsx`, `agent.js`, `slackTool.js`, and `gmailTool.js`.
    - Handled potential `undefined` return from `os.homedir()` in containerized environments (Render).
    - Standardized `ChatGoogleGenerativeAI` constructor calls to use positional arguments to avoid library-internal configuration crashes.
