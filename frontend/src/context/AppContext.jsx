import { createContext, useContext, useState, useCallback, useEffect } from 'react';
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
        setOnboardingComplete(true);
        localStorage.setItem('edith_onboarding_complete', 'true');

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
        setOnboardingComplete(true);
        localStorage.setItem('edith_onboarding_complete', 'true');
        return data;
    }, []);

    // --- Sign In with Google ---
    const signInWithGoogle = useCallback(() => {
        return new Promise(async (resolve, reject) => {
            try {
                const res = await fetch(`${API_URL}/api/auth/google`);
                const { url } = await res.json();
                const authWindow = window.open(url, '_blank', 'width=600,height=700');

                const handleMessage = (event) => {
                    if (event.data?.type === 'AUTH_COMPLETE') {
                        window.removeEventListener('message', handleMessage);
                        const { email, name, preferredName: pName, titlePreference: tPref } = event.data;

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

                        setOnboardingComplete(true);
                        localStorage.setItem('edith_onboarding_complete', 'true');

                        // Google is now connected (tokens stored during sign-in)
                        refreshOauthStatus();

                        resolve({ email, name, preferredName: pName, titlePreference: tPref });
                    }
                };

                window.addEventListener('message', handleMessage);

                // Cleanup if window is closed without completing
                const checkClosed = setInterval(() => {
                    if (authWindow?.closed) {
                        clearInterval(checkClosed);
                        window.removeEventListener('message', handleMessage);
                        // Only reject if we haven't resolved yet
                        if (!isAuthenticated) {
                            reject(new Error('Sign-in window closed'));
                        }
                    }
                }, 1000);
            } catch (err) {
                reject(err);
            }
        });
    }, [refreshOauthStatus, isAuthenticated]);

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
    }, []);

    // --- Chat Messages (persists across navigation) ---
    const [messages, setMessages] = useState([]);
    const [historyLoaded, setHistoryLoaded] = useState(false);

    const value = {
        userId,
        userEmail,
        googleName,
        isAuthenticated,
        authLoading,
        signIn,
        register,
        signInWithGoogle,
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
    };

    return (
        <AppContext.Provider value={value}>
            {children}
        </AppContext.Provider>
    );
};

export const useApp = () => useContext(AppContext);
