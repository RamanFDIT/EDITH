import { NavLink, useNavigate, useLocation } from 'react-router-dom';
import { useState, useRef, useEffect } from 'react';
import styles from "./NavBar.module.css";
import Logo from '../../assets/EDITH.svg?react';
import settings from '../../assets/settings.svg';
import hamburger from '../../assets/hamburger.svg';
import { Github, Figma, Calendar, MessageSquare, Plus, LogOut, Menu, X, FolderOpen, Trash2 } from 'lucide-react';
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

// Jira icon — used both as tool sidebar icon and small project indicator
const JiraIcon = ({ size = 12, className }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className={className || styles.projectIndicator}>
    <path d="M11.53 2c0 2.4 1.97 4.35 4.35 4.35h1.78v1.7c0 2.4 1.94 4.34 4.34 4.35V2.84a.84.84 0 00-.84-.84H11.53zM6.77 6.8a4.36 4.36 0 004.34 4.34h1.78v1.72a4.36 4.36 0 004.34 4.34V7.63a.84.84 0 00-.83-.83H6.77zM2 11.6a4.35 4.35 0 004.34 4.34h1.78v1.72c0 2.4 1.94 4.34 4.34 4.34v-9.57a.84.84 0 00-.84-.83H2z"/>
  </svg>
);

const NavBar = ({ onNewProject }) => {
  const { expanded: toggle, setExpanded, mobileOpen, setMobileOpen } = useNavBar();
  const {
    oauthStatus,
    projects,
    activeProjectId,
    setActiveProjectId,
    deleteProject,
    projectsAvailable,
  } = useApp();
  const navigate = useNavigate();
  const location = useLocation();
  const [deleteConfirm, setDeleteConfirm] = useState(null);
  const deleteTimerRef = useRef(null);

  // Clean up delete confirmation timer on unmount
  useEffect(() => {
    return () => { if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current); };
  }, []);

  const connectedTools = Object.entries(oauthStatus)
    .filter(([, info]) => info.connected)
    .map(([provider]) => provider);

  const handleClick = () => {
    setExpanded(!toggle);
  };

  const closeMobile = () => setMobileOpen(false);

  const handleProjectClick = (project, isMobile = false) => {
    setActiveProjectId(project._id);
    if (isMobile) closeMobile();
    // General project goes straight to chat, others to dashboard
    if (project.isDefault) {
      navigate(`/project/${project._id}/chat`);
    } else {
      navigate(`/project/${project._id}`);
    }
  };

  const handleDeleteProject = async (e, projectId) => {
    e.stopPropagation();
    if (deleteConfirm === projectId) {
      try {
        await deleteProject(projectId);
      } catch (err) {
        console.error('Delete failed:', err);
      }
      setDeleteConfirm(null);
    } else {
      setDeleteConfirm(projectId);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setDeleteConfirm(null), 3000);
    }
  };

  /* Project list section */
  const projectList = (isMobile = false) => (
    <div className={styles.projectSection}>
      <div className={(toggle || isMobile) ? styles.projectHeader : styles.projectHeaderCompact}>
        {(toggle || isMobile) && <p className={styles.sectionLabel}>Projects</p>}
        <button
          className={styles.newProjectBtn}
          onClick={() => {
            if (isMobile) closeMobile();
            if (onNewProject) onNewProject();
          }}
          title="New Project"
        >
          <Plus size={16} />
        </button>
      </div>
      <div className={styles.projectList}>
        {projects.map((project) => {
          const isActive = project._id === activeProjectId;
          const isCurrentRoute = location.pathname.includes(`/project/${project._id}`);
          return (
            <div
              key={project._id}
              className={`${(toggle || isMobile) ? styles.projectItem : styles.projectItemCompact} ${(isActive || isCurrentRoute) ? styles.projectItemActive : ''}`}
              onClick={() => handleProjectClick(project, isMobile)}
              title={project.name}
            >
              {(toggle || isMobile) ? (
                <>
                  <FolderOpen size={16} className={styles.projectIcon} />
                  <span className={styles.projectName}>{project.name}</span>
                  <div className={styles.projectIndicators}>
                    {project.githubRepo && <Github size={12} className={styles.projectIndicator} />}
                    {project.jiraProjectKey && <JiraIcon />}
                  </div>
                  {!project.isDefault && (
                    <button
                      className={`${styles.deleteBtn} ${deleteConfirm === project._id ? styles.deleteBtnConfirm : ''}`}
                      onClick={(e) => handleDeleteProject(e, project._id)}
                      title={deleteConfirm === project._id ? 'Click again to confirm' : 'Delete project'}
                    >
                      <Trash2 size={14} />
                    </button>
                  )}
                </>
              ) : (
                <span className={styles.projectInitial}>
                  {project.name.charAt(0).toUpperCase()}
                </span>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );

  /* Shared nav content used by both desktop and mobile */
  const navContent = (isMobile = false) => (
    <>
      <div className={styles.activeToolContainer}>
        {/* Project list (hidden if API unavailable) */}
        {projectsAvailable && projectList(isMobile)}

        {/* Divider */}
        {projectsAvailable && <div className={styles.divider} />}

        {/* Connected tools */}
        <div className={toggle || isMobile ? styles.toolsContainer : styles.toolsContainerCompact}>
          {(toggle || isMobile) && <p className={styles.sectionLabel}>Connected Tools</p>}
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

        {/* Settings + Logout */}
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
