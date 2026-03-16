import { createContext, useContext, useState, useCallback } from 'react';

const AppContext = createContext();

export const AppProvider = ({ children }) => {
    // --- OAuth Status (shared across NavBar, Settings, ConnectionPage) ---
    const [oauthStatus, setOauthStatus] = useState({
        github: false,
        google: false,
        slack: false,
        jira: false,
        figma: false,
    });

    const refreshOauthStatus = useCallback(async () => {
        try {
            const response = await fetch('http://localhost:3000/api/oauth/status');
            const data = await response.json();
            setOauthStatus(data);
        } catch (error) {
            console.error('[AppContext] Failed to refresh OAuth status:', error);
        }
    }, []);

    // --- Chat & Global State ---
    const [messages, setMessages] = useState([]);
    const [historyLoaded, setHistoryLoaded] = useState(false);

    const value = {
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
