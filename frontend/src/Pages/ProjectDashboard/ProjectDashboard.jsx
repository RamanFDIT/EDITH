import { useEffect, useState, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext.jsx';
import DonutChart from '../../components/DonutChart/DonutChart.jsx';
import ProjectModal from '../../components/ProjectModal/ProjectModal.jsx';
import { API_URL } from '../../apiConfig';
import { MessageSquare, Settings as SettingsIcon, Github, ExternalLink } from 'lucide-react';
import styles from './ProjectDashboard.module.css';

const GITHUB_COLORS = {
  'Open PRs': '#3b82f6',
  'Closed PRs': '#ef4444',
  'Merged PRs': '#a855f7',
  'Open Issues': '#22c55e',
  'Closed Issues': '#6b7280',
};

const JIRA_STATUS_COLORS = {
  'To Do': '#6b7280',
  'In Progress': '#3b82f6',
  'In Review': '#f59e0b',
  'Done': '#22c55e',
  'Backlog': '#8b5cf6',
};

// Assign colors dynamically for Jira statuses we haven't predefined
const FALLBACK_COLORS = ['#f97316', '#06b6d4', '#ec4899', '#84cc16', '#d946ef'];
let colorIndex = 0;
function getJiraColor(status) {
  if (JIRA_STATUS_COLORS[status]) return JIRA_STATUS_COLORS[status];
  const color = FALLBACK_COLORS[colorIndex % FALLBACK_COLORS.length];
  colorIndex++;
  return color;
}

const ProjectDashboard = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const {
    userEmail,
    projects,
    activeProjectId,
    setActiveProjectId,
    oauthStatus,
    refreshOauthStatus,
  } = useApp();

  const [githubStats, setGithubStats] = useState(null);
  const [jiraStats, setJiraStats] = useState(null);
  const [githubLoading, setGithubLoading] = useState(false);
  const [jiraLoading, setJiraLoading] = useState(false);
  const [githubError, setGithubError] = useState(null);
  const [jiraError, setJiraError] = useState(null);
  const [showEditModal, setShowEditModal] = useState(false);

  const project = projects.find(p => p._id === id);

  // Set active project if navigated directly via URL
  useEffect(() => {
    if (id && id !== activeProjectId) {
      setActiveProjectId(id);
    }
  }, [id, activeProjectId, setActiveProjectId]);

  // Redirect General project to chat (no dashboard)
  useEffect(() => {
    if (project?.isDefault) {
      navigate(`/project/${id}/chat`, { replace: true });
    }
  }, [project, id, navigate]);

  const fetchGithubStats = useCallback(async () => {
    if (!project?.githubRepo) return;
    setGithubLoading(true);
    setGithubError(null);
    try {
      const res = await fetch(`${API_URL}/api/projects/${id}/github-stats`, {
        headers: { 'X-User-Email': userEmail },
      });
      const data = await res.json();
      if (data.error === 'not_connected') {
        setGithubError('not_connected');
      } else if (data.error === 'no_repo_configured') {
        setGithubError('no_repo');
      } else if (data.error) {
        setGithubError('fetch_failed');
      } else {
        setGithubStats(data);
      }
    } catch {
      setGithubError('fetch_failed');
    } finally {
      setGithubLoading(false);
    }
  }, [id, project?.githubRepo, userEmail]);

  const fetchJiraStats = useCallback(async () => {
    if (!project?.jiraProjectKey) return;
    setJiraLoading(true);
    setJiraError(null);
    try {
      const res = await fetch(`${API_URL}/api/projects/${id}/jira-stats`, {
        headers: { 'X-User-Email': userEmail },
      });
      const data = await res.json();
      if (data.error === 'not_connected') {
        setJiraError('not_connected');
      } else if (data.error === 'no_key_configured') {
        setJiraError('no_key');
      } else if (data.error) {
        setJiraError('fetch_failed');
      } else {
        setJiraStats(data);
      }
    } catch {
      setJiraError('fetch_failed');
    } finally {
      setJiraLoading(false);
    }
  }, [id, project?.jiraProjectKey, userEmail]);

  useEffect(() => {
    if (project && !project.isDefault) {
      fetchGithubStats();
      fetchJiraStats();
    }
  }, [project, fetchGithubStats, fetchJiraStats]);

  const handleConnect = async (provider) => {
    try {
      const res = await fetch(`${API_URL}/api/oauth/connect/${provider}`, {
        headers: { 'X-User-Email': userEmail },
      });
      const { url } = await res.json();
      const authWindow = window.open(url, '_blank', 'width=600,height=700');

      const handleMessage = (event) => {
        if (event.data?.type === 'OAUTH_COMPLETE') {
          window.removeEventListener('message', handleMessage);
          refreshOauthStatus();
          if (provider === 'github') fetchGithubStats();
          if (provider === 'jira') fetchJiraStats();
        }
      };
      window.addEventListener('message', handleMessage);

      const checkClosed = setInterval(() => {
        if (authWindow?.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handleMessage);
        }
      }, 1000);
    } catch (err) {
      console.error(`Failed to connect ${provider}:`, err);
    }
  };

  if (!project) {
    return (
      <div className={styles.container}>
        <p className={styles.loading}>Loading project...</p>
      </div>
    );
  }

  const githubSegments = githubStats ? [
    { label: 'Open PRs', value: githubStats.prs.open, color: GITHUB_COLORS['Open PRs'] },
    { label: 'Closed PRs', value: githubStats.prs.closed, color: GITHUB_COLORS['Closed PRs'] },
    { label: 'Merged PRs', value: githubStats.prs.merged, color: GITHUB_COLORS['Merged PRs'] },
    { label: 'Open Issues', value: githubStats.issues.open, color: GITHUB_COLORS['Open Issues'] },
    { label: 'Closed Issues', value: githubStats.issues.closed, color: GITHUB_COLORS['Closed Issues'] },
  ] : [];

  const jiraSegments = jiraStats ? Object.entries(jiraStats.statuses).map(([status, count]) => ({
    label: status,
    value: count,
    color: getJiraColor(status),
  })) : [];

  return (
    <div className={styles.container}>
      {/* Header */}
      <div className={styles.header}>
        <div className={styles.headerLeft}>
          <h1 className={styles.projectName}>{project.name}</h1>
          <div className={styles.badges}>
            {project.githubRepo && (
              <span className={styles.badge}>
                <Github size={14} /> {project.githubRepo}
              </span>
            )}
            {project.jiraProjectKey && (
              <span className={styles.badge}>
                {project.jiraProjectKey}
              </span>
            )}
          </div>
        </div>
        <div className={styles.headerActions}>
          <button
            className={styles.editBtn}
            onClick={() => setShowEditModal(true)}
            title="Edit project settings"
          >
            <SettingsIcon size={18} />
          </button>
          <button
            className={styles.chatBtn}
            onClick={() => navigate(`/project/${id}/chat`)}
          >
            <MessageSquare size={18} />
            Open Chat
          </button>
        </div>
      </div>

      {/* Dashboard Charts */}
      <div className={styles.chartsGrid}>
        {/* GitHub Chart */}
        <div className={styles.chartCard}>
          {githubLoading ? (
            <p className={styles.loading}>Loading GitHub data...</p>
          ) : githubError === 'not_connected' ? (
            <div className={styles.connectCard}>
              <Github size={32} className={styles.connectIcon} />
              <p className={styles.connectText}>Connect GitHub to see repository insights</p>
              <button className={styles.connectBtn} onClick={() => handleConnect('github')}>
                Connect GitHub
              </button>
            </div>
          ) : githubError === 'no_repo' || !project.githubRepo ? (
            <div className={styles.connectCard}>
              <Github size={32} className={styles.connectIcon} />
              <p className={styles.connectText}>Add a GitHub repository to this project to see insights</p>
            </div>
          ) : githubError ? (
            <div className={styles.connectCard}>
              <p className={styles.connectText}>Failed to load GitHub data</p>
              <button className={styles.connectBtn} onClick={fetchGithubStats}>Retry</button>
            </div>
          ) : (
            <DonutChart
              segments={githubSegments}
              title="GitHub Overview"
              centerLabel="Items"
            />
          )}
        </div>

        {/* Jira Chart */}
        <div className={styles.chartCard}>
          {jiraLoading ? (
            <p className={styles.loading}>Loading Jira data...</p>
          ) : jiraError === 'not_connected' ? (
            <div className={styles.connectCard}>
              <ExternalLink size={32} className={styles.connectIcon} />
              <p className={styles.connectText}>Connect Jira to see ticket breakdown</p>
              <button className={styles.connectBtn} onClick={() => handleConnect('jira')}>
                Connect Jira
              </button>
            </div>
          ) : jiraError === 'no_key' || !project.jiraProjectKey ? (
            <div className={styles.connectCard}>
              <ExternalLink size={32} className={styles.connectIcon} />
              <p className={styles.connectText}>Add a Jira project key to this project to see insights</p>
            </div>
          ) : jiraError ? (
            <div className={styles.connectCard}>
              <p className={styles.connectText}>Failed to load Jira data</p>
              <button className={styles.connectBtn} onClick={fetchJiraStats}>Retry</button>
            </div>
          ) : (
            <DonutChart
              segments={jiraSegments}
              title="Jira Tickets"
              centerLabel="Tickets"
            />
          )}
        </div>
      </div>

      {showEditModal && (
        <ProjectModal
          existingProject={project}
          onClose={() => {
            setShowEditModal(false);
            // Re-fetch stats in case repo/key changed
            fetchGithubStats();
            fetchJiraStats();
          }}
        />
      )}
    </div>
  );
};

export default ProjectDashboard;
