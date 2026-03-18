import Logo from '../../assets/EDITH.svg?react';
import Button from '../../components/Button/Button.jsx';
import BackButton from '../../components/BackButton/BackButton.jsx';
import { useNavigate, useLocation } from 'react-router-dom';
import { useState } from 'react';
import { Github, Calendar, MessageSquare, CheckCircle2, Plug, Wifi, AlertCircle } from 'lucide-react';
import styles from './ConnectionPage.module.css';
import { useApp } from '../../context/AppContext.jsx';
import { API_URL } from '../../apiConfig.js';

const cardInfo = [
    { id: 1, cardHead: 'Google', oauth: 'google', description: 'Calendar & Gmail', icon: Calendar },
    { id: 2, cardHead: 'GitHub', oauth: 'github', description: 'Repos, PRs, commits, issues', icon: Github },
    { id: 3, cardHead: 'Jira', oauth: 'jira', description: 'Tickets, epics, sprints, projects', icon: CheckCircle2 },
    { id: 4, cardHead: 'Slack', oauth: 'slack', description: 'Send messages, post announcements', icon: MessageSquare },
];

const ConnectionPage = () => {
    const location = useLocation();
    const navigate = useNavigate();
    const { refreshOauthStatus } = useApp();
    const selectedTools = location.state?.selectedTools || [];
    const [connectionStatus, setConnectionStatus] = useState({});

    const toolsToShow = cardInfo.filter(card =>
        card.cardHead === 'GitHub' || selectedTools.includes(card.cardHead)
    );

    const handleConnection = async (providerKey) => {
        if (!providerKey) {
            console.error(`No OAuth provider mapped for "${providerKey}"`);
            return;
        }

        setConnectionStatus(prev => ({ ...prev, [providerKey]: 'connecting' }));

        try {
            const res = await fetch(`${API_URL}/api/oauth/connect/${providerKey}`);
            const { url } = await res.json();
            
            const authWindow = window.open(url, '_blank', 'width=600,height=800');
            
            const checkInterval = setInterval(async () => {
                try {
                    // Periodic poll regardless of window state
                    const statusRes = await fetch(`${API_URL}/api/oauth/status`);
                    const statusData = await statusRes.json();
                    
                    if (statusData[providerKey]?.connected) {
                        clearInterval(checkInterval);
                        setConnectionStatus(prev => ({ ...prev, [providerKey]: 'connected' }));
                        refreshOauthStatus();
                        authWindow.close();
                        return;
                    }

                    if (authWindow.closed) {
                        clearInterval(checkInterval);
                        setConnectionStatus(prev => ({ ...prev, [providerKey]: 'failed' }));
                    }
                } catch (err) {
                    // If COOP blocks authWindow.closed, we just keep polling the status
                    console.log("Window check blocked or fetch failed, continuing poll...");
                }
            }, 2000);

        } catch (err) {
            console.error(`OAuth error for "${providerKey}":`, err);
            setConnectionStatus(prev => ({ ...prev, [providerKey]: 'failed' }));
        }
    };

    const allConnected = toolsToShow.every(card => connectionStatus[card.oauth] === 'connected');

    const handleNext = async () => {
        navigate('/home');
    };

    return (
        <section className={styles.mainSection}>
            <div className={styles.container}>
                <Logo className={styles.logo} />
                <div className={styles.headerRow}>
                    <BackButton />
                    <h1 className={styles.header}>Connections</h1>
                </div>
                <p className={styles.subheading}>Connect your tools to get started</p>

                <h2 className={styles.sectionTitle}>
                    <Plug size={20} className={styles.sectionIcon} /> 
                    Integrations
                </h2>

                <div className={styles.cardGrid}>
                    {toolsToShow.map(({ id, cardHead, oauth, description, icon }) => {
                        const ProviderIcon = icon;
                        const status = connectionStatus[oauth] || 'idle';
                        const isRequired = cardHead === 'GitHub';

                        const cardClass =
                            status === 'connected' ? styles.oauthCardConnected :
                            status === 'failed' ? styles.oauthCardFailed :
                            styles.oauthCard;

                        const iconClass =
                            status === 'connected' ? styles.cardIconConnected :
                            status === 'failed' ? styles.cardIconFailed :
                            styles.cardIcon;

                        return (
                            <div key={id} className={cardClass}>
                                <div className={styles.cardInfo}>
                                    <ProviderIcon size={24} className={iconClass} />
                                    <div>
                                        <p className={styles.cardLabel}>
                                            {cardHead}
                                            {isRequired && <span className={styles.requiredBadge}>Primary Model</span>}
                                        </p>
                                        <p className={styles.cardDescription}>{description}</p>
                                    </div>
                                </div>
                                <div className={styles.cardActions}>
                                    {status === 'connected' && (
                                        <span className={styles.connectedBadge}>
                                            <Wifi size={12} /> Connected
                                        </span>
                                    )}
                                    {status === 'failed' && (
                                        <span className={styles.failedBadge}>
                                            <AlertCircle size={12} /> Failed
                                        </span>
                                    )}
                                    {status === 'connected' ? (
                                        <button className={styles.connectedButton}>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                <Wifi size={14} /> Connected
                                            </span>
                                        </button>
                                    ) : status === 'failed' ? (
                                        <button onClick={() => handleConnection(oauth)} className={styles.failedButton}>
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                <AlertCircle size={14} /> Retry
                                            </span>
                                        </button>
                                    ) : (
                                        <button
                                            onClick={() => handleConnection(oauth)}
                                            disabled={status === 'connecting'}
                                            className={styles.connectButton}
                                        >
                                            <span style={{ display: 'flex', alignItems: 'center', gap: '0.25rem' }}>
                                                <Plug size={14} /> {status === 'connecting' ? 'Connecting...' : 'Connect'}
                                            </span>
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>

                <div className={styles.nextButton}>
                    <Button disabled={!allConnected} onClick={handleNext} label="Next" />
                </div>
            </div>
        </section>
    );
};

export default ConnectionPage;
