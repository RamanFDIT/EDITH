import { useState, useEffect } from 'react';
import { Github, Figma, Calendar, MessageSquare, CheckCircle2, Plug, Unplug, Wifi } from 'lucide-react';
import styles from './Settings.module.css';
import { useNavBar } from '../../components/NavBar/NavBarContext.jsx';

const providers = [
  { key: 'google', label: 'Google', description: 'Calendar, Gmail & Vertex AI', icon: Calendar, },
  { key: 'github', label: 'GitHub', description: 'Repos, PRs, commits, issues', icon: Github },
  { key: 'slack', label: 'Slack', description: 'Send messages, post announcements', icon: MessageSquare },
  { key: 'figma', label: 'Figma', description: 'Read designs, post comments', icon: Figma },
  { key: 'jira', label: 'Jira', description: 'Tickets, epics, sprints, projects', icon: CheckCircle2 },
];

const Settings = () => {
  const { expanded } = useNavBar();
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
    if (window.electronAPI) {
      window.electronAPI.oauthStatus().then(setOauthStatus);
    }
  }, []);

  const handleConnect = async (provider) => {
    if (!window.electronAPI) return;
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

  const handleDisconnect = async (provider) => {
    if (!window.electronAPI) return;
    await window.electronAPI.oauthDisconnect(provider);
    setOauthStatus(prev => ({
      ...prev,
      [provider]: { connected: false, expired: true, hasRefreshToken: false },
    }));
    setStatus({ type: 'info', message: `Disconnected from ${provider}.` });
    setTimeout(() => setStatus({ type: '', message: '' }), 3000);
  };

  return (
    <section className={styles.mainSection}>
      <div className={expanded ? styles.container : styles.containerCompact}>
        <h1 className={styles.header}>Settings</h1>
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
