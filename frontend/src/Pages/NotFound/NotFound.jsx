import React from 'react';
import { useNavigate } from 'react-router-dom';
import { ShieldAlert, MoveLeft, Terminal } from 'lucide-react';
import styles from './NotFound.module.css';
import Logo from '../../assets/EDITH.svg?react';

const NotFound = () => {
    const navigate = useNavigate();

    return (
        <div className={styles.container}>
            <div className={styles.content}>
                <div className={styles.logoWrapper}>
                    <Logo className={styles.logo} />
                </div>
                
                <div className={styles.errorBox}>
                    <div className={styles.header}>
                        <ShieldAlert className={styles.alertIcon} size={32} />
                        <h1 className={styles.title}>404: COORDINATES LOST</h1>
                    </div>
                    
                    <div className={styles.terminal}>
                        <div className={styles.terminalHeader}>
                            <div className={styles.dots}>
                                <span className={styles.dot}></span>
                                <span className={styles.dot}></span>
                                <span className={styles.dot}></span>
                            </div>
                            <span className={styles.terminalTitle}>system_log.txt</span>
                        </div>
                        <div className={styles.terminalBody}>
                            <p className={styles.line}><span className={styles.prompt}>$</span> edith --scan-sector navigation</p>
                            <p className={styles.line}>Scanning for endpoint...</p>
                            <p className={`${styles.line} ${styles.error}`}>[FATAL ERROR] Sector 0x404: Null route encountered.</p>
                            <p className={styles.line}>The requested tactical data does not exist in the current grid.</p>
                            <p className={styles.line}><span className={styles.cursor}>_</span></p>
                        </div>
                    </div>

                    <p className={styles.description}>
                        You have strayed outside the operational parameters of E.D.I.T.H. 
                        Return to base to recalibrate your navigation systems.
                    </p>

                    <button className={styles.button} onClick={() => navigate('/')}>
                        <MoveLeft size={20} />
                        <span>RETURN TO BASE</span>
                    </button>
                </div>

                <div className={styles.footer}>
                    <Terminal size={14} />
                    <span>SECURE_LINK_ACTIVE // ENCRYPTION: AES-256</span>
                </div>
            </div>
            
            {/* Background Grid for tactical feel */}
            <div className={styles.gridOverlay}></div>
            <div className={styles.scanline}></div>
        </div>
    );
};

export default NotFound;
