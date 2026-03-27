import { useState, useRef, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Github, Figma, Calendar, MessageSquare, CheckCircle2, Plug, Unplug, Wifi, LogOut, Shield, User, AlertTriangle, RefreshCw } from 'lucide-react';
import styles from './Settings.module.css';
import { useNavBar } from '../../components/NavBar/NavBarContext.jsx';
import BackButton from '../../components/BackButton/BackButton.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { API_URL } from '../../apiConfig.js';

const JiraIcon = ({ size = 24, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className}>
    <path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 00-.84-.84H11.53zM6.77 6.8a4.36 4.36 0 004.34 4.34h1.78v1.72a4.36 4.36 0 004.34 4.34V7.63a.84.84 0 00-.83-.83H6.77zM2 11.6a4.35 4.35 0 004.34 4.34h1.78v1.72c0 2.4 1.94 4.34 4.34 4.34v-9.57a.84.84 0 00-.84-.83H2z"/>
  </svg>
);

const providers = [
  { key: 'google', label: 'Google', description: 'Calendar & Gmail', icon: Calendar, },
  { key: 'github', label: 'GitHub', description: 'Repos, PRs, commits, issues', icon: Github },
  { key: 'slack', label: 'Slack', description: 'Send messages, post announcements', icon: MessageSquare },
  { key: 'figma', label: 'Figma', description: 'Read designs, post comments', icon: Figma },
  { key: 'jira', label: 'Jira', description: 'Tickets, epics, sprints, projects', icon: JiraIcon },
];

const Settings = () => {
  const { expanded } = useNavBar();
  const { userEmail, googleName, oauthStatus, refreshOauthStatus, signOut, preferredName, titlePreference, updateUserPreferences } = useApp();
  const navigate = useNavigate();

  const [editName, setEditName] = useState(preferredName);
  const [editTitle, setEditTitle] = useState(titlePreference);
  const [prefsSaving, setPrefsSaving] = useState(false);
  const [prefsStatus, setPrefsStatus] = useState('');

  const prefsChanged = editName !== preferredName || editTitle !== titlePreference;

  const handleSavePreferences = async () => {
    const trimmed = editName.trim();
    if (trimmed.length < 2 || trimmed.length > 20) {
      setPrefsStatus('Name must be 2-20 characters');
      return;
    }
    if (!/^[a-zA-Z\s\-']+$/.test(trimmed)) {
      setPrefsStatus('Name can only contain letters, spaces, hyphens, and apostrophes');
      return;
    }
    setPrefsSaving(true);
    try {
      await updateUserPreferences(trimmed, editTitle);
      setPrefsStatus('Saved!');
    } catch {
      setPrefsStatus('Failed to save');
    } finally {
      setPrefsSaving(false);
      setTimeout(() => setPrefsStatus(''), 3000);
    }
  };

  const [status, setStatus] = useState({ type: '', message: '' });
  const [connecting, setConnecting] = useState('');
  const pollIntervalRef = useRef(null);
  const pollTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  const handleConnect = async (provider) => {
    // Clear any existing polling to prevent stacking
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);

    setConnecting(provider);
    try {
      const res = await fetch(`${API_URL}/api/oauth/connect/${provider}`, {
        headers: { 'X-User-Email': userEmail }
      });
      const { url } = await res.json();

      const authWindow = window.open(url, '_blank', 'width=600,height=800');

      // 2-minute timeout to stop polling if OAuth never completes
      pollTimeoutRef.current = setTimeout(() => {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
        pollTimeoutRef.current = null;
        setConnecting('');
        setStatus({ type: 'error', message: `Connection to ${provider} timed out.` });
        try { authWindow.close(); } catch (e) {}
      }, 120000);

      let pollCount = 0;
      const MAX_POLLS = 120; // safety net: 120 polls × 1s = 2 min

      pollIntervalRef.current = setInterval(async () => {
        pollCount++;
        if (pollCount > MAX_POLLS) {
          clearInterval(pollIntervalRef.current);
          clearTimeout(pollTimeoutRef.current);
          pollIntervalRef.current = null;
          pollTimeoutRef.current = null;
          setConnecting('');
          setStatus({ type: 'error', message: `Connection to ${provider} timed out.` });
          try { authWindow.close(); } catch (e) {}
          return;
        }

        try {
          // Poll status on every tick (not just on window close)
          const statusRes = await fetch(`${API_URL}/api/oauth/status`, {
            headers: { 'X-User-Email': userEmail }
          });
          const statusData = await statusRes.json();

          if (statusData[provider]?.connected) {
            clearInterval(pollIntervalRef.current);
            clearTimeout(pollTimeoutRef.current);
            pollIntervalRef.current = null;
            pollTimeoutRef.current = null;
            setStatus({ type: 'success', message: `Connected to ${provider}!` });
            await refreshOauthStatus();
            setConnecting('');
            try { authWindow.close(); } catch (e) {}
            return;
          }

          if (authWindow.closed) {
            clearInterval(pollIntervalRef.current);
            clearTimeout(pollTimeoutRef.current);
            pollIntervalRef.current = null;
            pollTimeoutRef.current = null;
            await refreshOauthStatus();
            setConnecting('');
          }
        } catch (err) {
          console.log("Window check blocked or fetch failed, continuing poll...");
        }
      }, 1000);

    } catch (err) {
      setStatus({ type: 'error', message: `OAuth error: ${err.message}` });
      setConnecting('');
    } finally {
      setTimeout(() => setStatus({ type: '', message: '' }), 5000);
    }
  };

  const handleReconnect = async (provider) => {
    await handleDisconnect(provider);
    setTimeout(() => handleConnect(provider), 500);
  };

  const handleDisconnect = async (provider) => {
    try {
      await fetch(`${API_URL}/api/oauth/disconnect/${provider}`, {
        method: 'POST',
        headers: { 'X-User-Email': userEmail }
      });
      setStatus({ type: 'info', message: `Disconnected from ${provider}.` });
      await refreshOauthStatus();
    } catch (err) {
      console.error('Disconnect failed:', err);
    }
    setTimeout(() => setStatus({ type: '', message: '' }), 3000);
  };

  const handleSignOut = () => {
    if (window.confirm('Sign out of EDITH? You will need to sign in again with Google.')) {
      signOut();
      navigate('/');
    }
  };

  return (
    <section className={styles.mainSection}>
      <div className={expanded ? styles.container : styles.containerCompact}>
        <div className={styles.headerRow}>
          <BackButton />
          <h1 className={styles.header}>Settings</h1>
        </div>
        <p className={styles.subheading}>Manage your connected integrations</p>

        {/* Account Info */}
        <div className={styles.accountCard}>
          <div className={styles.accountInfo}>
            <Shield size={20} className={styles.accountIcon} />
            <div>
              <p className={styles.accountEmail}>{userEmail}</p>
              {googleName && <p className={styles.accountName}>{googleName}</p>}
            </div>
          </div>
          <button onClick={handleSignOut} className={styles.signOutButton}>
            <LogOut size={14} /> Sign Out
          </button>
        </div>

        {/* User Preferences */}
        <h2 className={styles.sectionTitle}>
          <User size={20} className={styles.sectionIcon} />
          Preferences
        </h2>
        <div className={styles.prefsCard}>
          <div className={styles.prefsField}>
            <label className={styles.prefsLabel} htmlFor="prefName">Preferred Name</label>
            <input
              id="prefName"
              type="text"
              className={styles.prefsInput}
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="What should EDITH call you?"
              maxLength={20}
            />
          </div>
          <div className={styles.prefsField}>
            <label className={styles.prefsLabel}>How should EDITH address you?</label>
            <div className={styles.titleOptions}>
              {[{ value: 'Sir', label: 'Sir' }, { value: "Ma'am", label: "Ma'am" }, { value: 'name', label: 'Just my name' }].map(opt => (
                <button
                  key={opt.value}
                  className={editTitle === opt.value ? styles.titleOptionActive : styles.titleOption}
                  onClick={() => setEditTitle(opt.value)}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>
          <div className={styles.prefsActions}>
            {prefsStatus && <span className={styles.prefsStatus}>{prefsStatus}</span>}
            <button
              className={styles.connectButton}
              onClick={handleSavePreferences}
              disabled={!prefsChanged || prefsSaving}
            >
              {prefsSaving ? 'Saving...' : 'Save'}
            </button>
          </div>
        </div>

        {status.message && (
          <div className={`${styles.statusBar} ${
            status.type === 'success' ? styles.statusSuccess :
            status.type === 'error' ? styles.statusError : styles.statusInfo
          }`}>
            {status.type === 'success' && <CheckCircle2 size={16} />}
            {status.message}
          </div>
        )}

        <h2 className={styles.sectionTitle}>
          <Plug size={20} className={styles.sectionIcon} />
          Integrations
        </h2>

        <div className={styles.cardGrid}>
          {providers.map(({ key, label, description, icon: Icon }) => {
            const isConnected = oauthStatus[key]?.connected;
            const isConnecting = connecting === key;
            return (
              <div key={key} className={isConnected ? styles.oauthCardConnected : styles.oauthCard}>
                <div className={styles.cardInfo}>
                  <Icon size={24} className={isConnected ? styles.cardIconConnected : styles.cardIcon} />
                  <div>
                    <p className={styles.cardLabel}>
                      {label}
                    </p>
                    <p className={styles.cardDescription}>{description}</p>
                  </div>
                </div>
                <div className={styles.cardActions}>
                  {isConnected && (
                    <span className={styles.connectedBadge}>
                      <Wifi size={12} /> Connected
                      {oauthStatus[key]?.username && (
                        <span className={styles.connectedUsername}> ({oauthStatus[key].username})</span>
                      )}
                    </span>
                  )}
                  {key === 'jira' && isConnected && oauthStatus.jira?.agileEnabled === false && (
                    <span className={styles.scopeWarning}>
                      <AlertTriangle size={12} /> Sprints unavailable
                      <button onClick={() => handleReconnect('jira')} className={styles.reconnectButton}>
                        <RefreshCw size={12} /> Reconnect
                      </button>
                    </span>
                  )}
                  {isConnected ? (
                    <button onClick={() => handleDisconnect(key)} className={styles.disconnectButton}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Unplug size={14} /> Disconnect
                      </span>
                    </button>
                  ) : (
                    <button
                      onClick={() => handleConnect(key)}
                      disabled={isConnecting}
                      className={styles.connectButton}
                    >
                      <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                        <Plug size={14} /> {isConnecting ? 'Connecting...' : 'Connect'}
                      </span>
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
};

export default Settings;
