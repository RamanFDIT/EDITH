# EDITH Core - Tactical Assistant

EDITH (Even Dead I'm The Hero) is a sophisticated local AI assistant designed for developer productivity and system control. It integrates with your development tools (GitHub, Jira, Figma) and offers system-level control, all wrapped in a "Jarvis-like" tactical interface.

## 🚀 Capabilities

### 🛠 Development Tools
*   **GitHub**: 
    *   Manage repositories (Create repo).
    *   Manage Issues (List, Create).
    *   Track Commits and Pull Requests.
*   **Jira**: 
    *   Full Issue Management (Search, Create, Update, Delete).
    *   Project Management (Create Project).
*   **Figma**: 
    *   Scan file structures (Pages, Frames).
    *   Read and Post comments.

### 🖥 System Control
*   **System Status**: Monitor CPU, Memory, and Uptime.
*   **App Launcher**: Launch applications (e.g., "Open Chrome", "Launch Spotify").
*   **Terminal Ops**: Execute shell commands directly from the interface.

## 📦 Setup

1.  **Install dependencies**:
    ```bash
    npm install
    ```

2.  **Environment Configuration**:
    Create a `.env` file in the root directory with your keys:
    ```env
    # AI Provider
    GOOGLE_API_KEY=your_gemini_api_key

    # Jira Integration
    JIRA_API_TOKEN=your_jira_token
    JIRA_EMAIL=your_email@domain.com
    JIRA_DOMAIN=your-domain.atlassian.net

    # GitHub Integration
    GITHUB_TOKEN=your_github_personal_access_token

    # Figma Integration
    FIGMA_TOKEN=your_figma_personal_access_token
    
    # Voice Integration (New)
    OPENAI_API_KEY=your_openai_key_for_whisper
    ELEVENLABS_API_KEY=your_elevenlabs_key
    ```

## 🤝 Sharing with Friends (Safe Mode)

To share this app without giving away your API keys:

1.  **Build the App**:
    ```bash
    npm run dist
    ```
2.  **Share the Installer**:
    Send the `.exe` file from the `dist/` folder to your friends.
3.  **Instruct your Friend**:
    Tell them to create a `.edith.env` file in their **User Home Directory** (e.g., `C:\Users\John\.edith.env`) containing *their own* API keys. The app will automatically load keys from there.

## ⚡ Running the Application

### Option 1: Development Mode
Run the server and the Electron interface together:
```bash
npm start
```

### Option 2: Background Service (Recommended)
You can run the core server in the background using PM2, so it's always ready.

1.  **Install PM2** (if not installed):
    ```bash
    npm install -g pm2
    ```

2.  **Start the Server**:
    ```bash
    pm2 start server.js --name "EDITH_SYSTEM"
    ```

3.  **Enable Startup** (Optional - starts on boot):
    ```bash
    pm2 startup
    pm2 save
    ```

4.  **(Later) Launch the Interface**:
    You can then run the Electron app separately if needed, or just access the API.
    To launch the UI attached to the running server:
    ```bash
    npm start
    ```

## 🐛 Troubleshooting

*   **"Network response was not ok"**: Check that the server is running on port 3000 (`pm2 status` or check console).
*   **Authentication Errors**: Double-check your `.env` file for correct API keys and tokens.
*   **PM2 Issues**: Use `pm2 logs EDITH_SYSTEM` to see the server output.

## 📝 License
ISC
