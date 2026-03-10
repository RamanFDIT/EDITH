import Store from 'electron-store';

const store = new Store({
  name: 'edith-config',
  projectName: 'EDITH',
  defaults: {
    // LLM Provider: 'gemini' (cloud, needs GOOGLE_API_KEY) or 'ollama' (local, zero keys)
    LLM_PROVIDER: 'gemini',
    OLLAMA_MODEL: 'llama3.2',
    OLLAMA_BASE_URL: 'http://localhost:11434',

    // Legacy API key fields (still supported as fallback)
    OPENAI_API_KEY: '',
    GEMINI_API_KEY: '',
    ELEVENLABS_API_KEY: '',
    JIRA_API_TOKEN: '',
    JIRA_EMAIL: '',
    JIRA_DOMAIN: '',
    SLACK_BOT_TOKEN: '',
    SLACK_APP_TOKEN: '',
    GITHUB_PERSONAL_ACCESS_TOKEN: '',
    FIGMA_ACCESS_TOKEN: '',
    GOOGLE_CLIENT_ID: '',
    GOOGLE_CLIENT_SECRET: '',
    GOOGLE_REFRESH_TOKEN: '',

    // OAuth2.0 tokens (populated automatically by oauthService.js)
    oauth_google: null,
    oauth_github: null,
    oauth_slack: null,
    oauth_figma: null,
    oauth_jira: null,
  }
});

export default store;