import { useState, useEffect } from 'react';
import { Github, Figma, Calendar, MessageSquare, CheckCircle2, Plug, Unplug, Wifi } from 'lucide-react';
import styles from './Settings.module.css';
import { useNavBar } from '../../components/NavBar/NavBarContext.jsx';
import BackButton from '../../components/BackButton/BackButton.jsx';
import { useApp } from '../../context/AppContext.jsx';

const providers = [
  { key: 'google', label: 'Google', description: 'Calendar & Gmail', icon: Calendar, },
  { key: 'github', label: 'GitHub', description: 'Repos, PRs, commits, issues', icon: Github },
  { key: 'slack', label: 'Slack', description: 'Send messages, post announcements', icon: MessageSquare },
  { key: 'figma', label: 'Figma', description: 'Read designs, post comments', icon: Figma },
  { key: 'jira', label: 'Jira', description: 'Tickets, epics, sprints, projects', icon: CheckCircle2 },
];

const Settings = () => {
  const { expanded } = useNavBar();
  const { refreshOauthStatus } = useApp();
  const [oauthStatus, setOauthStatus] = useState({
    google: { connected: false },
    github: { connected: false },
    slack: { connected: false },
    figma: { connected: false },
    jira: { connected: false },
  });

  const [status, setStatus] = useState({ type: '', message: '' });
  const [connecting, setConnecting] = useState('');

  useEffect(() => {
    const fetchStatus = async () => {
      try {
        const res = await fetch('http://localhost:3000/api/oauth/status');
        const data = await res.json();
        setOauthStatus(data);
      } catch (err) {
        console.error('Failed to fetch OAuth status:', err);
      }
    };
    fetchStatus();
  }, []);

  const handleConnect = async (provider) => {
    setConnecting(provider);
    try {
      const res = await fetch(`http://localhost:3000/api/oauth/connect/${provider}`);
      const { url } = await res.json();
      
      // Open auth in a new window
      const authWindow = window.open(url, '_blank', 'width=600,height=800');
      
      // Poll for completion (simple way for this prototype)
      const checkInterval = setInterval(async () => {
        if (authWindow.closed) {
          clearInterval(checkInterval);
          const statusRes = await fetch('http://localhost:3000/api/oauth/status');
          const statusData = await statusRes.json();
          setOauthStatus(statusData);
          if (statusData[provider]?.connected) {
            setStatus({ type: 'success', message: `Connected to ${provider}!` });
            refreshOauthStatus();
          }
          setConnecting('');
        }
      }, 1000);

    } catch (err) {
      setStatus({ type: 'error', message: `OAuth error: ${err.message}` });
      setConnecting('');
    } finally {
      setTimeout(() => setStatus({ type: '', message: '' }), 5000);
    }
  };

  const handleDisconnect = async (provider) => {
    try {
      await fetch(`http://localhost:3000/api/oauth/disconnect/${provider}`, { method: 'POST' });
      setOauthStatus(prev => ({
        ...prev,
        [provider]: { connected: false, expired: true, hasRefreshToken: false },
      }));
      setStatus({ type: 'info', message: `Disconnected from ${provider}.` });
      refreshOauthStatus();
    } catch (err) {
      console.error('Disconnect failed:', err);
    }
    setTimeout(() => setStatus({ type: '', message: '' }), 3000);
  };

  return (
    <section className={styles.mainSection}>
      <div className={expanded ? styles.container : styles.containerCompact}>
        <div className={styles.headerRow}>
          <BackButton />
          <h1 className={styles.header}>Settings</h1>
        </div>
        <p className={styles.subheading}>Manage your connected integrations</p>

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
                    <p className={styles.cardLabel}>{label}</p>
                    <p className={styles.cardDescription}>{description}</p>
                  </div>
                </div>
                <div className={styles.cardActions}>
                  {isConnected && (
                    <span className={styles.connectedBadge}>
                      <Wifi size={12} /> Connected
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
