# Gemini Context: EDITH Core - Tactical Assistant

## 🚀 Project Overview
EDITH (Even Dead I'm The Hero) is a sophisticated local AI assistant designed for developer productivity and system control. It's an Electron-based desktop application that integrates with various development and productivity tools through a "Jarvis-like" tactical interface.

## 🏗 Architecture & Core Components
- **Main App**: Electron (`electron-main.cjs`, `main.js`, `preload.js`)
- **Backend Service**: Node.js/Express (`server.js`, `app.js`)
- **AI Core**: LangChain/LangGraph agent (`agent.js`)
- **LLM Support**:
    - **GitHub Models**: GPT-4o/GPT-4o-mini (via GitHub OAuth)
    - **Gemini API**: Gemini 2.5 Flash / 2.0 Flash Lite (via GOOGLE_API_KEY)
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
- **`oauthService.js`**: Manages OAuth2 tokens for Google (Calendar, Gmail) and GitHub.
- **`systemPrompt.js`**: Contains the complex instruction set for EDITH's personality and operational guidelines.
- **`envConfig.js`**: Handles local and global (`~/.edith.env`) environment variables for portability.

## 📦 Deployment
- **Packager**: `electron-builder`
- **Portability**: Supports "Safe Mode" where users can provide their own `.edith.env` for API keys.
