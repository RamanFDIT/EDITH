# EDITH Core - Tactical Assistant

## Project Overview
**E.D.I.T.H. (Even Dead I'm The Hero)** is a sophisticated, tactical local AI assistant designed for developer productivity and system control. It serves as a central hub for various developer tools (GitHub, Jira, Figma, Slack, Google Workspace) and provides system-level capabilities (app launching, terminal execution, hardware monitoring), all wrapped in a "Jarvis-like" interface.

### Key Technologies
- **Backend**: Node.js, Express, WebSockets (`ws`).
- **AI Orchestration**: LangChain, LangGraph (semantic routing).
- **Primary LLM**: Gemini (via `@google/genai` and `@langchain/google-genai`), with fallback options to OpenAI or local Ollama.
- **Database**: MongoDB (Mongoose) for chat history, user profiles, and project metadata.
- **Frontend (`/frontend`)**: React (Vite), Tailwind CSS, Recharts for data visualization, React Router DOM, `@huggingface/transformers`.
- **Frontend Website (`/frontend-website`)**: React (Vite), Tailwind CSS, Framer Motion (Landing/Marketing site).
- **Integrations**:
  - **GitHub**: Repository management, issues, PRs, commits.
  - **Jira**: Issue lifecycle, project creation, WBS/hierarchy generation.
  - **Figma**: File structure inspection, comment reading/posting.
  - **Google**: Calendar (scheduling), Gmail (email/contacts).
  - **Slack**: Messaging and announcements.
  - **System**: Shell execution, application launcher, CPU/RAM status.
  - **Audio**: Whisper (OpenAI) for transcription, ElevenLabs/Edge-TTS for speech synthesis.

## Directory Structure
- `/`: Main backend service, AI agent logic, and tool implementations.
  - `server.js`: Entry point, Express API, and static file serving.
  - `agent.js`: Core AI agent orchestration and tool routing.
  - `systemPrompt.js`: Defines the EDITH persona and operational protocols.
  - `*Tool.js`: Modular integration files for external services (e.g., `githubTool.js`, `jiraTool.js`, `audioTool.js`).
  - `oauthService.js`: Token management for OAuth-based integrations.
  - `db.js`: MongoDB schemas and connection logic.
- `/frontend`: The main React-based assistant interface.
- `/frontend-website`: A separate Vite/React site for landing and marketing purposes.

## Building and Running

### Prerequisites
- Node.js (v18+ recommended)
- MongoDB (running locally or a cloud instance)
- A `.env` file in the root directory with necessary API keys (refer to `README.md` for the list).

### Backend (Development)
```bash
npm install
npm run dev:backend
```
*Starts the server at `http://localhost:3000` with file watching.*

### Frontend (Development)
```bash
# You can run it from the root:
npm run dev:frontend

# Or from the frontend directory:
cd frontend
npm install
npm run dev
```
*Starts the Vite dev server at `http://localhost:5173`.*

### Frontend Website (Development)
```bash
cd frontend-website
npm install
npm run dev
```

### Production Build
```bash
# From the root directory:
npm run build
# Starts the server and serves the built frontend
npm start
```

### Background Service (Optional)
```bash
npm install -g pm2
pm2 start server.js --name "EDITH_SYSTEM"
```

## Development Conventions

### AI Personality & Tone
- **Name**: E.D.I.T.H.
- **Tone**: Sophisticated, British (RP), dry wit, concise.
- **Protocols**: 
  - **Anti-Hallucination**: Never simulate tool output. Must invoke real tools.
  - **Action-First**: Execute requested actions immediately if parameters are available.
  - **Data Fidelity**: Prioritize accurate data retrieval from tools over conversation.

### Tool Development
- Tools are implemented as modular `*Tool.js` files.
- Each tool should ideally follow the `DynamicStructuredTool` pattern from LangChain.
- All tools are integrated into the React agent in `agent.js`.

### Authentication
- Authentication is handled via `oauthService.js`.
- The system supports multiple users with isolated data via `x-user-email` and `x-user-id` headers.

### Testing
- Currently, there is no comprehensive test suite setup (TODO). 
- `test_oauth.js` is available for testing OAuth flows manually.
