import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useApp } from '../../context/AppContext.jsx';
import { API_URL } from '../../apiConfig.js';
import { X, Github, ExternalLink } from 'lucide-react';
import styles from './ProjectModal.module.css';
import { ease, durations } from '../../lib/motion.js';

const ProjectModal = ({ onClose, existingProject = null }) => {
  const { userEmail, oauthStatus, refreshOauthStatus, createProject, updateProject, deleteProject, setActiveProjectId } = useApp();
  const navigate = useNavigate();

  const [name, setName] = useState(existingProject?.name || '');
  const [jiraProjectKey, setJiraProjectKey] = useState(existingProject?.jiraProjectKey || '');
  const [githubRepo, setGithubRepo] = useState(existingProject?.githubRepo || '');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [connecting, setConnecting] = useState('');

  const deleteTimerRef = useRef(null);
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

    let finalGithubRepo = githubRepo.trim();
    if (finalGithubRepo) {
      // Extract owner/repo from full URL if provided (e.g. https://github.com/RamanFDIT/EDITH)
      const urlMatch = finalGithubRepo.match(/(?:https?:\/\/)?(?:www\.)?github\.com\/([a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+)\/?/i);
      if (urlMatch) {
        finalGithubRepo = urlMatch[1];
      }

      if (!/^[a-zA-Z0-9._-]+\/[a-zA-Z0-9._-]+$/.test(finalGithubRepo)) {
        setError('GitHub repo must be in owner/repo format or a valid GitHub URL');
        return;
      }
    }

    if (jiraProjectKey && !/^[A-Z][A-Z0-9_]{1,9}$/.test(jiraProjectKey)) {
      setError('Jira key must be uppercase letters/numbers (2-10 chars)');
      return;
    }

    setSaving(true);
    try {
      if (isEdit) {
        await updateProject(existingProject._id, { name: name.trim(), jiraProjectKey, githubRepo: finalGithubRepo });
      } else {
        const project = await createProject({ name: name.trim(), jiraProjectKey, githubRepo: finalGithubRepo });
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

  const handleDelete = async () => {
    if (!deleteConfirm) {
      setDeleteConfirm(true);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
      deleteTimerRef.current = setTimeout(() => setDeleteConfirm(false), 3000);
      return;
    }
    setDeleting(true);
    try {
      await deleteProject(existingProject._id);
      navigate('/home');
      onClose();
    } catch (err) {
      setError(err.message);
      setDeleting(false);
    }
  };

  // Close on Escape + cleanup timer
  useEffect(() => {
    const handleKey = (e) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handleKey);
    return () => {
      window.removeEventListener('keydown', handleKey);
      if (deleteTimerRef.current) clearTimeout(deleteTimerRef.current);
    };
  }, [onClose]);

  return (
    <motion.div
      className={styles.overlay}
      onClick={onClose}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: durations.fast, ease }}
    >
      <motion.div
        className={styles.modal}
        onClick={(e) => e.stopPropagation()}
        initial={{ opacity: 0, scale: 0.96, y: 8 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.97, y: 4 }}
        transition={{ duration: durations.modal, ease }}
      >
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

        <div className={isEdit ? styles.footerEdit : styles.footer}>
          {isEdit && (
            <button
              className={deleteConfirm ? styles.deleteProjectBtnConfirm : styles.deleteProjectBtn}
              onClick={handleDelete}
              disabled={deleting}
            >
              {deleting ? 'Deleting...' : deleteConfirm ? 'Confirm Delete' : 'Delete Project'}
            </button>
          )}
          <div className={styles.footerActions}>
            <button className={styles.cancelBtn} onClick={onClose}>Cancel</button>
            <button className={styles.saveBtn} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : (isEdit ? 'Save Changes' : 'Create Project')}
            </button>
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
};

export default ProjectModal;
