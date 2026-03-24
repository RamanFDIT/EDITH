# GEMINI.md - EDITH Core Tactical Assistant

## Project Overview
**E.D.I.T.H (Even Dead I'm The Hero)** is a sophisticated, tactical AI assistant designed for developer productivity and system control. It serves as a central hub for various developer tools (GitHub, Jira, Figma, Slack, Google Workspace) and provides system-level capabilities (app launching, terminal execution, hardware monitoring).

### Key Technologies
- **Backend**: Node.js, Express.
- **AI Orchestration**: LangChain, LangGraph (with semantic routing).
- **Primary LLM**: Gemini (via `@google/genai` and LangChain), with fallback to OpenAI or local Ollama.
- **Database**: MongoDB (Mongoose) for chat history, user profiles, and project metadata.
- **Frontend**: React (Vite), Tailwind CSS, Recharts for data visualization.
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
  - `*Tool.js`: Modular integration files for external services.
  - `oauthService.js`: Token management for OAuth-based integrations.
  - `db.js`: MongoDB schemas and connection logic.
- `/frontend`: The main React-based assistant interface.
- `/frontend-website`: A separate Vite/React site, likely for landing/marketing.

## Building and Running

### Prerequisites
- Node.js (v18+ recommended)
- MongoDB (running locally or a cloud instance)
- A `.env` file with necessary API keys (refer to `README.md` for the list).

### Backend (Development)
```bash
npm install
npm run dev:backend
```
*Starts the server at `http://localhost:3000` with file watching.*

### Frontend (Development)
```bash
cd frontend
npm install
npm run dev
```
*Starts the Vite dev server at `http://localhost:5173`.*

### Production Build
```bash
npm run build
npm start
```
*Builds the frontend and serves it via the backend on port 3000.*

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
- Currently, there is no comprehensive test suite (TODO). 
- `test_oauth.js` is available for testing OAuth flows.
