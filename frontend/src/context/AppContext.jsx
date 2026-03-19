import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { API_URL } from '../apiConfig';

const AppContext = createContext();

export const AppProvider = ({ children }) => {
    // --- User Identity (Persistence) ---
    const [userId, setUserId] = useState(() => {
        const saved = localStorage.getItem('edith_user_id');
        if (saved) return saved;
        // Fallback-friendly UUID generation
        const newId = `user_${(window.crypto?.randomUUID ? window.crypto.randomUUID() : Math.random().toString(36).substring(2, 10))}`;
        localStorage.setItem('edith_user_id', newId);
        return newId;
    });

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
        try {
            const res = await fetch(`${API_URL}/api/oauth/status`, {
                headers: { 'X-User-ID': userId }
            });
            const status = await res.json();
            setOauthStatus(status);
            localStorage.setItem('edith_oauth_status', JSON.stringify(status));
        } catch (err) {
            console.error('Failed to refresh OAuth status:', err);
        }
    }, [userId]);

    // Fetch OAuth status on mount so all consumers start with real data
    useEffect(() => {
        refreshOauthStatus();
    }, [refreshOauthStatus]);

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
                    'X-User-ID': userId,
                },
                body: JSON.stringify({ preferredName: name, titlePreference: title }),
            });
        } catch (err) {
            console.error('Failed to save user preferences:', err);
        }
    }, [userId]);

    // --- Chat Messages (persists across navigation) ---
    const [messages, setMessages] = useState([]);
    const [historyLoaded, setHistoryLoaded] = useState(false);

    const value = {
        userId,
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
