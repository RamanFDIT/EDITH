import { createContext, useContext, useState, useCallback } from 'react';

const AppContext = createContext();

export const AppProvider = ({ children }) => {
    // --- OAuth Status (shared across NavBar, Settings, ConnectionPage) ---
    const [oauthStatus, setOauthStatus] = useState({});

    const refreshOauthStatus = useCallback(async () => {
        try {
            const res = await fetch('http://localhost:3000/api/oauth/status');
            const status = await res.json();
            setOauthStatus(status);
        } catch (err) {
            console.error('Failed to refresh OAuth status:', err);
        }
    }, []);

    // --- Chat Messages (persists across navigation) ---
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
