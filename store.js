import Store from 'electron-store';

const store = new Store({
  name: 'edith-config',
  projectName: 'EDITH',
  defaults: {
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
    GOOGLE_REFRESH_TOKEN: ''
  }
});

export default store;