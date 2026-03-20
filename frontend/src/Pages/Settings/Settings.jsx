import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Github, Figma, Calendar, MessageSquare, CheckCircle2, Plug, Unplug, Wifi, LogOut, Shield } from 'lucide-react';
import styles from './Settings.module.css';
import { useNavBar } from '../../components/NavBar/NavBarContext.jsx';
import BackButton from '../../components/BackButton/BackButton.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { API_URL } from '../../apiConfig.js';

const providers = [
  { key: 'google', label: 'Google', description: 'Calendar & Gmail', icon: Calendar, },
  { key: 'github', label: 'GitHub', description: 'Repos, PRs, commits, issues', icon: Github },
  { key: 'slack', label: 'Slack', description: 'Send messages, post announcements', icon: MessageSquare },
  { key: 'figma', label: 'Figma', description: 'Read designs, post comments', icon: Figma },
  { key: 'jira', label: 'Jira', description: 'Tickets, epics, sprints, projects', icon: CheckCircle2 },
];

const Settings = () => {
  const { expanded } = useNavBar();
  const { userEmail, googleName, oauthStatus, refreshOauthStatus, signOut } = useApp();
  const navigate = useNavigate();

  const [status, setStatus] = useState({ type: '', message: '' });
  const [connecting, setConnecting] = useState('');

  const handleConnect = async (provider) => {
    setConnecting(provider);
    try {
      const res = await fetch(`${API_URL}/api/oauth/connect/${provider}`, {
        headers: { 'X-User-Email': userEmail }
      });
      const { url } = await res.json();

      const authWindow = window.open(url, '_blank', 'width=600,height=800');

      const checkInterval = setInterval(async () => {
        if (authWindow.closed) {
          clearInterval(checkInterval);
          const statusRes = await fetch(`${API_URL}/api/oauth/status`, {
            headers: { 'X-User-Email': userEmail }
          });
          const statusData = await statusRes.json();
          if (statusData[provider]?.connected) {
            setStatus({ type: 'success', message: `Connected to ${provider}!` });
          }
          await refreshOauthStatus();
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
    // Google is tied to sign-in — disconnecting means signing out
    if (provider === 'google') {
      if (!window.confirm('Google is your sign-in provider. Disconnecting will sign you out. Continue?')) {
        return;
      }
      signOut();
      navigate('/');
      return;
    }

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
            const isGoogleAuth = key === 'google';

            return (
              <div key={key} className={isConnected ? styles.oauthCardConnected : styles.oauthCard}>
                <div className={styles.cardInfo}>
                  <Icon size={24} className={isConnected ? styles.cardIconConnected : styles.cardIcon} />
                  <div>
                    <p className={styles.cardLabel}>
                      {label}
                      {isGoogleAuth && isConnected && <span className={styles.authBadge}>Sign-In</span>}
                    </p>
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
                        <Unplug size={14} /> {isGoogleAuth ? 'Sign Out' : 'Disconnect'}
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
