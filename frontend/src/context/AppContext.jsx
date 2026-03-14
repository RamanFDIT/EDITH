import { createContext, useContext, useState, useCallback } from 'react';

const AppContext = createContext();

export const AppProvider = ({ children }) => {
    // --- OAuth Status (shared across NavBar, Settings, ConnectionPage) ---
    const [oauthStatus, setOauthStatus] = useState({});

    const refreshOauthStatus = useCallback(async () => {
        if (window.electronAPI) {
            const status = await window.electronAPI.oauthStatus();
            setOauthStatus(status);
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
