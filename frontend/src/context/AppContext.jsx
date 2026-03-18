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
    const [oauthStatus, setOauthStatus] = useState({});

    const refreshOauthStatus = useCallback(async () => {
        try {
            const res = await fetch(`${API_URL}/api/oauth/status`, {
                headers: { 'X-User-ID': userId }
            });
            const status = await res.json();
            setOauthStatus(status);
        } catch (err) {
            console.error('Failed to refresh OAuth status:', err);
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
