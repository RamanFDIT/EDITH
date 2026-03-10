import React, { useState, useEffect } from 'react';
import { Save, Key, Calendar, MessageSquare, Github, Figma, HardDrive, CheckCircle2, XCircle, Plug, Unplug, Cpu, Wifi, WifiOff } from 'lucide-react';

const Settings = () => {
  const [config, setConfig] = useState({
    LLM_PROVIDER: 'gemini',
    OLLAMA_MODEL: 'llama3.2',
    OLLAMA_BASE_URL: 'http://localhost:11434',
    GEMINI_API_KEY: '',
    GOOGLE_CLOUD_PROJECT: '',
    GOOGLE_CLOUD_LOCATION: 'us-central1',
  });

  const [oauthStatus, setOauthStatus] = useState({
    google: { connected: false },
    github: { connected: false },
    slack: { connected: false },
    figma: { connected: false },
    jira: { connected: false },
  });

  const [status, setStatus] = useState({ type: '', message: '' });
  const [connecting, setConnecting] = useState('');

  // Load config and OAuth status on mount
  useEffect(() => {
    if (window.electronAPI) {
      window.electronAPI.getConfig().then((cfg) => {
        setConfig(prev => ({ ...prev, ...cfg }));
      });
      window.electronAPI.oauthStatus().then(setOauthStatus);
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
        await window.electronAPI.saveConfig({
          LLM_PROVIDER: config.LLM_PROVIDER,
          OLLAMA_MODEL: config.OLLAMA_MODEL,
          OLLAMA_BASE_URL: config.OLLAMA_BASE_URL,
          GEMINI_API_KEY: config.GEMINI_API_KEY,
          GOOGLE_CLOUD_PROJECT: config.GOOGLE_CLOUD_PROJECT,
          GOOGLE_CLOUD_LOCATION: config.GOOGLE_CLOUD_LOCATION,
        });
      }
      setStatus({ type: 'success', message: 'Configuration saved! Restart E.D.I.T.H. to apply LLM changes.' });
      setTimeout(() => setStatus({ type: '', message: '' }), 5000);
    } catch {
      setStatus({ type: 'error', message: 'Failed to save configuration.' });
    }
  };

  const handleOAuthConnect = async (provider) => {
    if (!window.electronAPI) {
      alert(`This would trigger the ${provider} OAuth flow in the Electron app.`);
      return;
    }
    setConnecting(provider);
    try {
      const result = await window.electronAPI.oauthConnect(provider);
      if (result.success) {
        setOauthStatus(prev => ({
          ...prev,
          [provider]: { connected: true, expired: false, hasRefreshToken: true },
        }));
        setStatus({ type: 'success', message: `Connected to ${provider}!` });
      } else {
        setStatus({ type: 'error', message: `Failed to connect ${provider}: ${result.error}` });
      }
    } catch (err) {
      setStatus({ type: 'error', message: `OAuth error: ${err.message}` });
    } finally {
      setConnecting('');
      setTimeout(() => setStatus({ type: '', message: '' }), 5000);
    }
  };

  const handleOAuthDisconnect = async (provider) => {
    if (!window.electronAPI) return;
    await window.electronAPI.oauthDisconnect(provider);
    setOauthStatus(prev => ({
      ...prev,
      [provider]: { connected: false, expired: true, hasRefreshToken: false },
    }));
    setStatus({ type: 'info', message: `Disconnected from ${provider}.` });
    setTimeout(() => setStatus({ type: '', message: '' }), 3000);
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

  const OAuthCard = ({ provider, label, icon: Icon, description, color = "blue" }) => {
    const isConnected = oauthStatus[provider]?.connected;
    const isConnecting = connecting === provider;
    const colorMap = {
      blue: 'bg-blue-600 hover:bg-blue-700',
      purple: 'bg-purple-600 hover:bg-purple-700',
      green: 'bg-green-600 hover:bg-green-700',
      orange: 'bg-orange-600 hover:bg-orange-700',
      red: 'bg-red-600 hover:bg-red-700',
    };

    return (
      <div className={`flex items-center justify-between p-4 rounded-lg border ${
        isConnected ? 'border-green-800 bg-green-950/30' : 'border-gray-700 bg-gray-800/50'
      }`}>
        <div className="flex items-center">
          <Icon className={`w-5 h-5 mr-3 ${isConnected ? 'text-green-400' : 'text-gray-400'}`} />
          <div>
            <p className="text-white font-medium">{label}</p>
            <p className="text-xs text-gray-400">{description}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {isConnected && (
            <span className="flex items-center text-xs text-green-400 mr-2">
              <Wifi className="w-3 h-3 mr-1" /> Connected
            </span>
          )}
          {isConnected ? (
            <button
              onClick={() => handleOAuthDisconnect(provider)}
              className="flex items-center bg-gray-700 hover:bg-red-800 text-gray-300 hover:text-white px-3 py-1.5 rounded-md text-sm transition-colors"
            >
              <Unplug className="w-3 h-3 mr-1" /> Disconnect
            </button>
          ) : (
            <button
              onClick={() => handleOAuthConnect(provider)}
              disabled={isConnecting}
              className={`flex items-center ${colorMap[color]} text-white px-3 py-1.5 rounded-md text-sm transition-colors disabled:opacity-50`}
            >
              <Plug className="w-3 h-3 mr-1" />
              {isConnecting ? 'Connecting...' : 'Connect'}
            </button>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className="max-w-4xl mx-auto p-6">
      <div className="flex justify-between items-center mb-8">
        <div>
          <h1 className="text-3xl font-bold text-white">E.D.I.T.H. Settings</h1>
          <p className="text-gray-400 mt-1">Connect services with one click — no API keys required</p>
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
        {/* LEFT COLUMN */}
        <div>
          {/* LLM PROVIDER */}
          <Section title="AI Engine" icon={Cpu}>
            <p className="text-sm text-gray-400 mb-4">
              Choose between cloud AI (Gemini, requires API key) or local AI (Ollama, <strong className="text-green-400">zero keys needed</strong>).
            </p>
            <div className="mb-4">
              <label className="block text-sm font-medium text-gray-300 mb-2">LLM Provider</label>
              <div className="flex gap-3">
                <button
                  onClick={() => setConfig(prev => ({ ...prev, LLM_PROVIDER: 'gemini' }))}
                  className={`flex-1 p-3 rounded-lg border text-center transition-colors ${
                    config.LLM_PROVIDER === 'gemini'
                      ? 'border-blue-500 bg-blue-950/50 text-blue-400'
                      : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  <Wifi className="w-5 h-5 mx-auto mb-1" />
                  <p className="font-medium text-sm">Gemini</p>
                  <p className="text-xs opacity-60">Cloud · Key or OAuth</p>
                </button>
                <button
                  onClick={() => setConfig(prev => ({ ...prev, LLM_PROVIDER: 'ollama' }))}
                  className={`flex-1 p-3 rounded-lg border text-center transition-colors ${
                    config.LLM_PROVIDER === 'ollama'
                      ? 'border-green-500 bg-green-950/50 text-green-400'
                      : 'border-gray-700 bg-gray-800 text-gray-400 hover:border-gray-600'
                  }`}
                >
                  <WifiOff className="w-5 h-5 mx-auto mb-1" />
                  <p className="font-medium text-sm">Ollama</p>
                  <p className="text-xs opacity-60">Local · Zero Keys</p>
                </button>
              </div>
            </div>

            {config.LLM_PROVIDER === 'gemini' && (
              <>
                <p className="text-xs text-gray-400 mb-3">
                  <strong className="text-blue-400">Option A:</strong> Paste an API key below. <br/>
                  <strong className="text-green-400">Option B:</strong> Connect Google (right panel) + set a GCP Project below for <strong>OAuth-based Vertex AI</strong> (no API key needed).
                </p>
                <InputField label="Google API Key (fallback)" name="GEMINI_API_KEY" placeholder="AIza..." />
                <div className="border-t border-gray-800 pt-3 mt-2">
                  <p className="text-xs text-green-400 font-medium mb-2">Vertex AI OAuth Config</p>
                  <InputField label="GCP Project ID" name="GOOGLE_CLOUD_PROJECT" type="text" placeholder="my-project-12345" />
                  <InputField label="GCP Region" name="GOOGLE_CLOUD_LOCATION" type="text" placeholder="us-central1" />
                </div>
              </>
            )}

            {config.LLM_PROVIDER === 'ollama' && (
              <>
                <InputField label="Ollama Model" name="OLLAMA_MODEL" type="text" placeholder="llama3.2" />
                <InputField label="Ollama URL" name="OLLAMA_BASE_URL" type="text" placeholder="http://localhost:11434" />
                <p className="text-xs text-green-400 mt-2">
                  Install Ollama from ollama.com, then run: <code className="bg-gray-800 px-1 rounded">ollama pull llama3.2</code>
                </p>
              </>
            )}
          </Section>

          {/* FILESYSTEM */}
          <Section title="Filesystem MCP" icon={HardDrive}>
            <p className="text-sm text-gray-400">
              The filesystem MCP is pre-configured for your local directories.
              No authentication needed.
            </p>
            <span className="inline-flex items-center text-xs text-green-400 mt-2">
              <CheckCircle2 className="w-3 h-3 mr-1" /> Always available
            </span>
          </Section>
        </div>

        {/* RIGHT COLUMN — OAuth Integrations */}
        <div>
          <Section title="Integrations (OAuth2.0)" icon={Plug}>
            <p className="text-sm text-gray-400 mb-4">
              Click <strong>Connect</strong> to sign in with each service. No API keys or tokens to copy.
            </p>
            <div className="space-y-3">
              <OAuthCard
                provider="google"
                label="Google (Calendar + Gemini)"
                icon={Calendar}
                description="Calendar access + Vertex AI (OAuth Gemini)"
                color="blue"
              />
              <OAuthCard
                provider="github"
                label="GitHub"
                icon={Github}
                description="Repos, PRs, commits, issues"
                color="purple"
              />
              <OAuthCard
                provider="slack"
                label="Slack"
                icon={MessageSquare}
                description="Send messages, post announcements"
                color="green"
              />
              <OAuthCard
                provider="figma"
                label="Figma"
                icon={Figma}
                description="Read designs, post comments"
                color="orange"
              />
              <OAuthCard
                provider="jira"
                label="Jira"
                icon={CheckCircle2}
                description="Tickets, epics, sprints, projects"
                color="blue"
              />
            </div>
          </Section>
        </div>
      </div>
    </div>
  );
};

export default Settings;