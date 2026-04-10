import { createContext, useContext, useState, useCallback, useEffect, useMemo } from 'react';
import { API_URL } from '../apiConfig';

const AppContext = createContext();

export const AppProvider = ({ children }) => {
    // --- Google Sign-In Identity ---
    const [userEmail, setUserEmail] = useState(() => localStorage.getItem('edith_auth_email') || '');
    const [googleName, setGoogleName] = useState(() => localStorage.getItem('edith_auth_name') || '');
    const [isAuthenticated, setIsAuthenticated] = useState(() => !!localStorage.getItem('edith_auth_email'));
    const [authLoading, setAuthLoading] = useState(true);

    // Keep userId as alias for consumers that still reference it
    const userId = userEmail;

    // --- Onboarding Status (Persistence) ---
    const [onboardingComplete, setOnboardingComplete] = useState(() => {
        return localStorage.getItem('edith_onboarding_complete') === 'true';
    });

    const updateOnboardingComplete = (value) => {
        setOnboardingComplete(value);
        localStorage.setItem('edith_onboarding_complete', value);
    };

    // --- OAuth Status (shared across NavBar, Settings, ConnectionPage) ---
    const [oauthStatus, setOauthStatus] = useState(() => {
        const saved = localStorage.getItem('edith_oauth_status');
        return saved ? JSON.parse(saved) : {};
    });

    const refreshOauthStatus = useCallback(async () => {
        if (!userEmail) return;
        try {
            const res = await fetch(`${API_URL}/api/oauth/status`, {
                headers: { 'X-User-Email': userEmail }
            });
            if (!res.ok) {
                console.warn('[OAuth] Status fetch failed:', res.status);
                return;
            }
            const status = await res.json();
            if (!status || typeof status !== 'object' || status.error) {
                console.warn('[OAuth] Invalid status response:', status);
                return;
            }
            setOauthStatus(status);
            localStorage.setItem('edith_oauth_status', JSON.stringify(status));
        } catch (err) {
            console.error('Failed to refresh OAuth status:', err);
        }
    }, [userEmail]);

    // --- User Preferences (Persistence) ---
    const [preferredName, setPreferredName] = useState(() => {
        return localStorage.getItem('edith_preferred_name') || '';
    });
    const [titlePreference, setTitlePreference] = useState(() => {
        return localStorage.getItem('edith_title_preference') || 'Sir';
    });

    const updateUserPreferences = useCallback(async (name, title) => {
        setPreferredName(name);
        setTitlePreference(title);
        localStorage.setItem('edith_preferred_name', name);
        localStorage.setItem('edith_title_preference', title);
        try {
            await fetch(`${API_URL}/api/user/preferences`, {
                method: 'PUT',
                headers: {
                    'Content-Type': 'application/json',
                    'X-User-Email': userEmail,
                },
                body: JSON.stringify({ preferredName: name, titlePreference: title }),
            });
        } catch (err) {
            console.error('Failed to save user preferences:', err);
        }
    }, [userEmail]);

    // --- Session Validation on mount ---
    useEffect(() => {
        const validateSession = async () => {
            const storedEmail = localStorage.getItem('edith_auth_email');
            if (!storedEmail) {
                setAuthLoading(false);
                return;
            }

            try {
                const res = await fetch(`${API_URL}/api/auth/session`, {
                    headers: { 'X-User-Email': storedEmail }
                });
                const data = await res.json();

                if (data.valid) {
                    setUserEmail(data.email);
                    setGoogleName(data.name || '');
                    setIsAuthenticated(true);
                    if (data.preferredName) {
                        setPreferredName(data.preferredName);
                        localStorage.setItem('edith_preferred_name', data.preferredName);
                    }
                    if (data.titlePreference) {
                        setTitlePreference(data.titlePreference);
                        localStorage.setItem('edith_title_preference', data.titlePreference);
                    }
                    if (data.oauthStatus) {
                        setOauthStatus(data.oauthStatus);
                        localStorage.setItem('edith_oauth_status', JSON.stringify(data.oauthStatus));
                    }
                    if (data.onboardingComplete) {
                        setOnboardingComplete(true);
                        localStorage.setItem('edith_onboarding_complete', 'true');
                    }
                } else {
                    // Session invalid — clear stored auth
                    localStorage.removeItem('edith_auth_email');
                    localStorage.removeItem('edith_auth_name');
                    setUserEmail('');
                    setGoogleName('');
                    setIsAuthenticated(false);
                    setOnboardingComplete(false);
                    localStorage.removeItem('edith_onboarding_complete');
                }
            } catch (err) {
                console.error('[Auth] Session validation failed:', err);
                // Keep cached state on network error (offline tolerance)
            } finally {
                setAuthLoading(false);
            }
        };

        validateSession();
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Fetch OAuth status after auth is confirmed
    useEffect(() => {
        if (isAuthenticated && !authLoading) {
            refreshOauthStatus();
        }
    }, [isAuthenticated, authLoading, refreshOauthStatus]);

    // --- Email/Password Auth ---
    const signIn = useCallback(async (email, password) => {
        const res = await fetch(`${API_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Login failed');

        localStorage.setItem('edith_auth_email', data.email);
        localStorage.setItem('edith_auth_name', data.name || '');
        setUserEmail(data.email);
        setGoogleName(data.name || '');
        setIsAuthenticated(true);
        if (data.preferredName) {
            setOnboardingComplete(true);
            localStorage.setItem('edith_onboarding_complete', 'true');
        }

        if (data.preferredName) {
            setPreferredName(data.preferredName);
            localStorage.setItem('edith_preferred_name', data.preferredName);
        }
        if (data.titlePreference) {
            setTitlePreference(data.titlePreference);
            localStorage.setItem('edith_title_preference', data.titlePreference);
        }
        return data;
    }, []);

    const register = useCallback(async (email, password) => {
        const res = await fetch(`${API_URL}/api/auth/register`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ email, password }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || 'Registration failed');

        localStorage.setItem('edith_auth_email', data.email);
        localStorage.setItem('edith_auth_name', data.name || '');
        setUserEmail(data.email);
        setGoogleName(data.name || '');
        setIsAuthenticated(true);
        // Don't mark onboarding complete — UserSetup will do that after the user sets their name
        return data;
    }, []);

    // --- Sign In with Google (redirect-based, no popup) ---
    const signInWithGoogle = useCallback(async () => {
        const res = await fetch(`${API_URL}/api/auth/google`);
        const { url } = await res.json();
        // Redirect current page to Google OAuth — callback redirects back to /#/auth/callback
        window.location.href = url;
    }, []);

    // Complete Google sign-in from callback URL params
    const completeGoogleSignIn = useCallback(({ email, name, preferredName: pName, titlePreference: tPref }) => {
        localStorage.setItem('edith_auth_email', email);
        localStorage.setItem('edith_auth_name', name || '');
        setUserEmail(email);
        setGoogleName(name || '');
        setIsAuthenticated(true);

        if (pName) {
            setPreferredName(pName);
            localStorage.setItem('edith_preferred_name', pName);
        }
        if (tPref) {
            setTitlePreference(tPref);
            localStorage.setItem('edith_title_preference', tPref);
        }

        // Only mark onboarding complete for returning users who have a preferred name
        if (pName) {
            setOnboardingComplete(true);
            localStorage.setItem('edith_onboarding_complete', 'true');
        }
    }, []);

    // --- Sign Out ---
    const signOut = useCallback(() => {
        // Clear all EDITH localStorage keys
        const keysToRemove = [];
        for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key && key.startsWith('edith_')) {
                keysToRemove.push(key);
            }
        }
        keysToRemove.forEach(key => localStorage.removeItem(key));

        setUserEmail('');
        setGoogleName('');
        setIsAuthenticated(false);
        setOnboardingComplete(false);
        setOauthStatus({});
        setPreferredName('');
        setTitlePreference('Sir');
        setProjects([]);
        setActiveProjectIdRaw('');
    }, []);

    // --- Chat Messages (persists across navigation) ---
    const [messages, setMessages] = useState([]);
    const [historyLoaded, setHistoryLoaded] = useState(false);

    // --- Pending message (for sending from ProjectDashboard → Chat) ---
    const [pendingMessage, setPendingMessage] = useState('');

    // --- Projects ---
    const [projects, setProjects] = useState([]);
    const [activeProjectId, setActiveProjectIdRaw] = useState(
        () => localStorage.getItem('edith_active_project') || ''
    );

    const activeProject = useMemo(
        () => projects.find(p => p._id === activeProjectId) || null,
        [projects, activeProjectId]
    );

    const activeSessionId = useMemo(() => {
        if (!activeProjectId) return 'session-general';
        const proj = projects.find(p => p._id === activeProjectId);
        if (proj?.isDefault) return 'session-general';
        // If projects aren't loaded yet but we have an ID, use project-scoped session
        if (!proj) return `project-${activeProjectId}`;
        return `project-${activeProjectId}`;
    }, [projects, activeProjectId]);

    const setActiveProjectId = useCallback((id) => {
        setActiveProjectIdRaw(prev => {
            if (prev === id) return prev;
            // Reset chat state so Home re-fetches for the new session
            setMessages([]);
            setHistoryLoaded(false);
            return id;
        });
        localStorage.setItem('edith_active_project', id);
    }, []);

    const [projectsAvailable, setProjectsAvailable] = useState(true);

    const loadProjects = useCallback(async () => {
        if (!userEmail) return;
        try {
            const res = await fetch(`${API_URL}/api/projects`, {
                headers: { 'X-User-Email': userEmail }
            });
            if (!res.ok) {
                setProjectsAvailable(false);
                return;
            }
            const data = await res.json();
            setProjectsAvailable(true);
            setProjects(data.projects || []);

            // If no active project set, default to the General project
            const storedId = localStorage.getItem('edith_active_project');
            const ids = (data.projects || []).map(p => p._id);
            if (!storedId || !ids.includes(storedId)) {
                const general = (data.projects || []).find(p => p.isDefault);
                if (general) {
                    setActiveProjectIdRaw(general._id);
                    localStorage.setItem('edith_active_project', general._id);
                }
            }
        } catch (err) {
            console.error('[Projects] Load error:', err);
            setProjectsAvailable(false);
        }
    }, [userEmail]);

    const createProject = useCallback(async (projectData) => {
        const res = await fetch(`${API_URL}/api/projects`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'X-User-Email': userEmail },
            body: JSON.stringify(projectData),
        });
        if (!res.ok) {
            const text = await res.text();
            let errorMsg = 'Failed to create project';
            try { errorMsg = JSON.parse(text).error || errorMsg; } catch {}
            throw new Error(errorMsg);
        }
        const data = await res.json();
        await loadProjects();
        return data.project;
    }, [userEmail, loadProjects]);

    const updateProject = useCallback(async (id, projectData) => {
        const res = await fetch(`${API_URL}/api/projects/${id}`, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json', 'X-User-Email': userEmail },
            body: JSON.stringify(projectData),
        });
        if (!res.ok) {
            const text = await res.text();
            let errorMsg = 'Failed to update project';
            try { errorMsg = JSON.parse(text).error || errorMsg; } catch {}
            throw new Error(errorMsg);
        }
        const data = await res.json();
        await loadProjects();
        return data.project;
    }, [userEmail, loadProjects]);

    const deleteProject = useCallback(async (id) => {
        const res = await fetch(`${API_URL}/api/projects/${id}`, {
            method: 'DELETE',
            headers: { 'X-User-Email': userEmail },
        });
        if (!res.ok) {
            const text = await res.text();
            let errorMsg = 'Failed to delete project';
            try { errorMsg = JSON.parse(text).error || errorMsg; } catch {}
            throw new Error(errorMsg);
        }
        // If we deleted the active project, switch to General
        if (id === activeProjectId) {
            const general = projects.find(p => p.isDefault);
            if (general) setActiveProjectId(general._id);
        }
        await loadProjects();
    }, [userEmail, activeProjectId, projects, setActiveProjectId, loadProjects]);

    // Load projects after auth is confirmed
    useEffect(() => {
        if (isAuthenticated && !authLoading) {
            loadProjects();
        }
    }, [isAuthenticated, authLoading, loadProjects]);

    const value = {
        userId,
        userEmail,
        googleName,
        isAuthenticated,
        authLoading,
        signIn,
        register,
        signInWithGoogle,
        completeGoogleSignIn,
        signOut,
        onboardingComplete,
        setOnboardingComplete: updateOnboardingComplete,
        oauthStatus,
        setOauthStatus,
        refreshOauthStatus,
        preferredName,
        titlePreference,
        updateUserPreferences,
        messages,
        setMessages,
        historyLoaded,
        setHistoryLoaded,
        pendingMessage,
        setPendingMessage,
        projects,
        projectsAvailable,
        activeProjectId,
        activeProject,
        activeSessionId,
        setActiveProjectId,
        loadProjects,
        createProject,
        updateProject,
        deleteProject,
    };

    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    );
};

export const useApp = () => useContext(AppContext);
