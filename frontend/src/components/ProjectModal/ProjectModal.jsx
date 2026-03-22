import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useApp } from '../../context/AppContext.jsx';
import { API_URL } from '../../apiConfig.js';
import { X, Github, ExternalLink } from 'lucide-react';
import styles from './ProjectModal.module.css';

const ProjectModal = ({ onClose, existingProject = null }) => {
  const { userEmail, oauthStatus, refreshOauthStatus, createProject, updateProject, setActiveProjectId } = useApp();
  const navigate = useNavigate();

  const [name, setName] = useState(existingProject?.name || '');
  const [jiraProjectKey, setJiraProjectKey] = useState(existingProject?.jiraProjectKey || '');
  const [githubRepo, setGithubRepo] = useState(existingProject?.githubRepo || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState('');

  const isEdit = !!existingProject;
  const githubConnected = oauthStatus.github?.connected;
  const jiraConnected = oauthStatus.jira?.connected;

  const handleConnect = async (provider) => {
    setConnecting(provider);
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
          setConnecting('');
        }
      };
      window.addEventListener('message', handleMessage);

      const checkClosed = setInterval(() => {
        if (authWindow?.closed) {
          clearInterval(checkClosed);
          window.removeEventListener('message', handleMessage);
          setConnecting('');
        }
      }, 1000);
    } catch (err) {
      console.error(`Failed to connect ${provider}:`, err);
      setConnecting('');
    }
  };

  const handleSave = async () => {
    setError('');

    if (!name.trim() || name.trim().length > 50) {
      setError('Project name must be 1-50 characters');
      return;
    }

    if (githubRepo && !/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(githubRepo)) {
      setError('GitHub repo must be in owner/repo format');
      return;
    }

    if (jiraProjectKey && !/^[A-Z][A-Z0-9_]{1,9}$/.test(jiraProjectKey)) {
      setError('Jira key must be uppercase letters/numbers (2-10 chars)');
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await updateProject(existingProject._id, { name: name.trim(), jiraProjectKey, githubRepo });
      } else {
        const project = await createProject({ name: name.trim(), jiraProjectKey, githubRepo });
        setActiveProjectId(project._id);
        navigate(`/project/${project._id}`);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Close on Escape
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  return (
    <div className={styles.overlay} onClick={onClose}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <div className={styles.header}>
          <h2 className={styles.title}>{isEdit ? 'Edit Project' : 'New Project'}</h2>
          <button className={styles.closeBtn} onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className={styles.body}>
          {/* Project Name */}
          <div className={styles.field}>
            <label className={styles.label}>Project Name *</label>
            <input
              type="text"
              className={styles.input}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="My Awesome Project"
              maxLength={50}
              autoFocus
            />
          </div>

          {/* GitHub Repo */}
          <div className={styles.field}>
            <label className={styles.label}>
              <Github size={14} /> GitHub Repository
            </label>
            {githubConnected ? (
              <input
                type="text"
                className={styles.input}
                value={githubRepo}
                onChange={(e) => setGithubRepo(e.target.value)}
                placeholder="owner/repo-name"
              />
            ) : (
              <div className={styles.connectPrompt}>
                <span className={styles.connectText}>GitHub not connected</span>
                <button
                  className={styles.connectBtn}
                  onClick={() => handleConnect('github')}
                  disabled={connecting === 'github'}
                >
                  {connecting === 'github' ? 'Connecting...' : 'Connect GitHub'}
                </button>
              </div>
            )}
          </div>

          {/* Jira Project Key */}
          <div className={styles.field}>
            <label className={styles.label}>
              <ExternalLink size={14} /> Jira Project Key
            </label>
            {jiraConnected ? (
              <input
                type="text"
                className={styles.input}
                value={jiraProjectKey}
                onChange={(e) => setJiraProjectKey(e.target.value.toUpperCase())}
                placeholder="PROJ"
              />
            ) : (
              <div className={styles.connectPrompt}>
                <span className={styles.connectText}>Jira not connected</span>
                <button
                  className={styles.connectBtn}
                  onClick={() => handleConnect('jira')}
                  disabled={connecting === 'jira'}
                >
                  {connecting === 'jira' ? 'Connecting...' : 'Connect Jira'}
                </button>
              </div>
            )}
          </div>

          {error && <p className={styles.error}>{error}</p>}
        </div>

        <div className={styles.footer}>
          <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
          <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
            {saving ? 'Saving...' : (isEdit ? 'Save Changes' : 'Create Project')}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProjectModal;
