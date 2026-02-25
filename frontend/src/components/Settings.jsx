import React, { useState, useEffect } from 'react';
import { Save, Key, Calendar, MessageSquare, Github, Figma, HardDrive, CheckCircle2, XCircle } from 'lucide-react';

const Settings = () => {
  const [config, setConfig] = useState({
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
  });

  const [status, setStatus] = useState({ type: '', message: '' });

  // In a real Electron app, we would load these from the backend
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getConfig().then(setConfig);
    }
  }, []);

  const handleChange = (e) => {
    const { name, value } = e.target;
    setConfig(prev => ({ ...prev, [name]: value }));
  };

  const handleSave = async () => {
    try {
      setStatus({ type: 'info', message: 'Saving configuration...' });
      if (window.electronAPI) {
        await window.electronAPI.saveConfig(config);
      } else {
        // Simulate network delay for dev
        await new Promise(resolve => setTimeout(resolve, 800));
      }
      
      setStatus({ type: 'success', message: 'Configuration saved successfully! Restart E.D.I.T.H. to apply changes.' });
      setTimeout(() => setStatus({ type: '', message: '' }), 5000);
    } catch (error) {
      setStatus({ type: 'error', message: 'Failed to save configuration.' });
    }
  };

  const handleGoogleAuth = async () => {
    if (window.electronAPI) {
      await window.electronAPI.triggerGoogleAuth();
    } else {
      alert("This would trigger the Google OAuth flow in the Electron backend.");
    }
  };

  const InputField = ({ label, name, type = "password", placeholder = "" }) => (
    <div className="mb-4">
      <label className="block text-sm font-medium text-gray-300 mb-1">{label}</label>
      <input
        type={type}
        name={name}
        value={config[name] || ''}
        onChange={handleChange}
        placeholder={placeholder}
        className="w-full bg-gray-800 border border-gray-700 rounded-md px-3 py-2 text-white focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
      />
    </div>
  );

  const Section = ({ title, icon: Icon, children }) => (
    <div className="bg-gray-900 rounded-lg p-6 mb-6 border border-gray-800">
      <div className="flex items-center mb-4 pb-2 border-b border-gray-800">
        <Icon className="w-5 h-5 mr-2 text-blue-400" />
        <h2 className="text-lg font-semibold text-white">{title}</h2>
      </div>
      {children}
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">E.D.I.T.H. Settings</h1>
          <p className="text-gray-400 mt-1">Manage your API keys and integrations</p>
        </div>
        <button
          onClick={handleSave}
          className="flex items-center bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-md transition-colors"
        >
          <Save className="w-4 h-4 mr-2" />
          Save Changes
        </button>
      </div>

      {status.message && (
        <div className={`p-4 mb-6 rounded-md flex items-center ${
          status.type === 'success' ? 'bg-green-900/50 text-green-400 border border-green-800' : 
          status.type === 'error' ? 'bg-red-900/50 text-red-400 border border-red-800' : 
          'bg-blue-900/50 text-blue-400 border border-blue-800'
        }`}>
          {status.type === 'success' ? <CheckCircle2 className="w-5 h-5 mr-2" /> : 
           status.type === 'error' ? <XCircle className="w-5 h-5 mr-2" /> : null}
          {status.message}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <div>
          <Section title="AI Models" icon={Key}>
            <InputField label="OpenAI API Key" name="OPENAI_API_KEY" />
            <InputField label="Gemini API Key" name="GEMINI_API_KEY" />
            <InputField label="ElevenLabs API Key (Optional)" name="ELEVENLABS_API_KEY" />
          </Section>

          <Section title="Jira Integration" icon={CheckCircle2}>
            <InputField label="Jira Domain (e.g., your-domain.atlassian.net)" name="JIRA_DOMAIN" type="text" />
            <InputField label="Jira Email" name="JIRA_EMAIL" type="email" />
            <InputField label="Jira API Token" name="JIRA_API_TOKEN" />
          </Section>
          
          <Section title="Google Calendar" icon={Calendar}>
            <p className="text-sm text-gray-400 mb-4">
              Connect your Google account to allow E.D.I.T.H. to manage your calendar events.
            </p>
            <div className="mb-4">
              <button 
                onClick={handleGoogleAuth}
                className="bg-white text-gray-900 hover:bg-gray-100 font-medium px-4 py-2 rounded-md transition-colors flex items-center"
              >
                <svg className="w-4 h-4 mr-2" viewBox="0 0 24 24">
                  <path fill="currentColor" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" />
                  <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                  <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                  <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
                </svg>
                Sign in with Google
              </button>
            </div>
            <div className="mt-4 pt-4 border-t border-gray-800">
              <p className="text-xs text-gray-500 mb-2">Or enter credentials manually:</p>
              <InputField label="Google Client ID" name="GOOGLE_CLIENT_ID" type="text" />
              <InputField label="Google Client Secret" name="GOOGLE_CLIENT_SECRET" />
              <InputField label="Google Refresh Token" name="GOOGLE_REFRESH_TOKEN" />
            </div>
          </Section>
        </div>

        <div>
          <Section title="Slack MCP" icon={MessageSquare}>
            <InputField label="Slack Bot Token (xoxb-...)" name="SLACK_BOT_TOKEN" />
            <InputField label="Slack App Token (xapp-...)" name="SLACK_APP_TOKEN" />
          </Section>

          <Section title="GitHub MCP" icon={Github}>
            <InputField label="Personal Access Token" name="GITHUB_PERSONAL_ACCESS_TOKEN" />
          </Section>

          <Section title="Figma MCP" icon={Figma}>
            <InputField label="Personal Access Token" name="FIGMA_ACCESS_TOKEN" />
          </Section>
          
          <Section title="Filesystem MCP" icon={HardDrive}>
            <p className="text-sm text-gray-400 mb-2">
              The filesystem MCP is configured to access your local directories.
              You can modify the allowed paths in the configuration file.
            </p>
          </Section>
        </div>
      </div>
    </div>
  );
};

export default Settings;