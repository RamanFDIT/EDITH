import { NavLink, useNavigate } from 'react-router-dom';
import styles from "./NavBar.module.css";
import Logo from '../../assets/EDITH.svg?react';
import settings from '../../assets/settings.svg';
import hamburger from '../../assets/hamburger.svg';
import { Github, Figma, Calendar, MessageSquare, Plus, LogOut, Menu, X } from 'lucide-react';
import { useNavBar } from './NavBarContext.jsx';
import { useApp } from '../../context/AppContext.jsx';

const toolDisplayNames = {
  google: 'Google',
  github: 'GitHub',
  slack: 'Slack',
  figma: 'Figma',
  jira: 'Jira',
};

const toolIcons = {
  google: Calendar,
  github: Github,
  slack: MessageSquare,
  figma: Figma,
  jira: Plus,
};

const NavBar = () => {
  const { expanded: toggle, setExpanded, mobileOpen, setMobileOpen } = useNavBar();
  const { oauthStatus, refreshOauthStatus } = useApp();
  const navigate = useNavigate();

  const connectedTools = Object.entries(oauthStatus)
    .filter(([, info]) => info.connected)
    .map(([provider]) => provider);

  const handleClick = () => {
    setExpanded(!toggle);
  };

  const closeMobile = () => setMobileOpen(false);

  /* Shared nav content used by both desktop and mobile */
  const navContent = (isMobile = false) => (
    <>
      <div className={styles.activeToolContainer}>
        <div className={toggle || isMobile ? styles.toolsContainer : styles.toolsContainerCompact}>
          {connectedTools.map((provider) => {
            const Icon = toolIcons[provider];
            return (
              <div key={provider} className={styles.tools}>
                <div className={styles.activeTools}></div>
                {Icon && <Icon size={18} className={styles.toolIcon} />}
                <p className={(toggle || isMobile) ? styles.toolName : styles.displayNone}>
                  {toolDisplayNames[provider]}
                </p>
              </div>
            );
          })}
        </div>
        <div className={styles.settingContainer}>
          <NavLink
            className={(toggle || isMobile) ? styles.profile : styles.profileCompact}
            to="/settings"
            onClick={isMobile ? closeMobile : undefined}
          >
            <img src={settings} className={styles.settings} alt="settings" />
            <p className={(!toggle && !isMobile) ? styles.displayNone : undefined}>Settings</p>
          </NavLink>
          <button
            className={(toggle || isMobile) ? styles.logoutButton : styles.logoutButtonCompact}
            onClick={() => {
              if (isMobile) closeMobile();
              navigate('/');
            }}
          >
            <LogOut size={20} className={styles.logoutIcon} />
            <p className={(!toggle && !isMobile) ? styles.displayNone : undefined}>Log Out</p>
          </button>
        </div>
      </div>
    </>
  );

  return (
    <>
      {/* ── Mobile Top Bar (< md) ── */}
      <div className={styles.mobileTopBar}>
        <Logo
          className={styles.mobilelogo}
          alt="EDITH Logo"
          onClick={() => navigate('/home')}
          style={{ cursor: 'pointer' }}
        />
        <button onClick={() => setMobileOpen(true)} className={styles.mobileMenuBtn}>
          <Menu size={24} />
        </button>
      </div>

      {/* ── Mobile Overlay Nav (< md) ── */}
      {mobileOpen && (
        <div className={styles.mobileOverlay}>
          <div className={styles.mobileBackdrop} onClick={closeMobile} />
          <div className={styles.mobileNav}>
            <div className={styles.mobileNavHeader}>
              <Logo
                className={styles.logo}
                alt="EDITH Logo"
                onClick={() => { closeMobile(); navigate('/home'); }}
                style={{ cursor: 'pointer' }}
              />
              <button onClick={closeMobile} className={styles.mobileCloseBtn}>
                <X size={24} />
              </button>
            </div>
            {navContent(true)}
          </div>
        </div>
      )}

      {/* ── Desktop Sidebar (>= md) ── */}
      <nav className={toggle ? styles.navBar : styles.navBarCompact}>
        <div className={toggle ? styles.logoContainer : styles.logoContainerCompact}>
          <Logo
            className={toggle ? styles.logo : styles.displayNone}
            alt="EDITH Logo"
            onClick={() => navigate('/home')}
            style={{ cursor: 'pointer' }}
          />
          <img onClick={handleClick} src={hamburger} className={styles.hamburger} alt="arrow" />
        </div>
        {navContent(false)}
      </nav>
    </>
  );
};

export default NavBar;
