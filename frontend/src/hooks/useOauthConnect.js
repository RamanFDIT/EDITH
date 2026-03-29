import { useState, useRef, useEffect } from 'react';
import { API_URL } from '../apiConfig.js';

export function useOauthConnect(userEmail, refreshOauthStatus) {
  const [status, setStatus] = useState({ type: '', message: '' });
  const [connecting, setConnecting] = useState('');
  const pollIntervalRef = useRef(null);
  const pollTimeoutRef = useRef(null);

  useEffect(() => {
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
      if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);
    };
  }, []);

  const handleConnect = async (provider) => {
    if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    if (pollTimeoutRef.current) clearTimeout(pollTimeoutRef.current);

    setConnecting(provider);
    try {
      const res = await fetch(`${API_URL}/api/oauth/connect/${provider}`, {
        headers: { 'X-User-Email': userEmail }
      });
      const { url } = await res.json();

      const authWindow = window.open(url, '_blank', 'width=600,height=800');

      pollTimeoutRef.current = setTimeout(() => {
        if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
        pollTimeoutRef.current = null;
        setConnecting('');
        setStatus({ type: 'error', message: `Connection to ${provider} timed out.` });
        try { authWindow.close(); } catch { /* popup may already be closed */ }
      }, 120000);

      let pollCount = 0;
      const MAX_POLLS = 120;

      pollIntervalRef.current = setInterval(async () => {
        pollCount++;
        if (pollCount > MAX_POLLS) {
          clearInterval(pollIntervalRef.current);
          clearTimeout(pollTimeoutRef.current);
          pollIntervalRef.current = null;
          pollTimeoutRef.current = null;
          setConnecting('');
          setStatus({ type: 'error', message: `Connection to ${provider} timed out.` });
          try { authWindow.close(); } catch { /* popup may already be closed */ }
          return;
        }

        try {
          const statusRes = await fetch(`${API_URL}/api/oauth/status`, {
            headers: { 'X-User-Email': userEmail }
          });
          const statusData = await statusRes.json();

          if (statusData[provider]?.connected) {
            clearInterval(pollIntervalRef.current);
            clearTimeout(pollTimeoutRef.current);
            pollIntervalRef.current = null;
            pollTimeoutRef.current = null;
            setStatus({ type: 'success', message: `Connected to ${provider}!` });
            await refreshOauthStatus();
            setConnecting('');
            try { authWindow.close(); } catch { /* popup may already be closed */ }
            return;
          }

          if (authWindow.closed) {
            clearInterval(pollIntervalRef.current);
            clearTimeout(pollTimeoutRef.current);
            pollIntervalRef.current = null;
            pollTimeoutRef.current = null;
            await refreshOauthStatus();
            setConnecting('');
          }
        } catch {
          console.log("Window check blocked or fetch failed, continuing poll...");
        }
      }, 1000);

    } catch (err) {
      setStatus({ type: 'error', message: `OAuth error: ${err.message}` });
      setConnecting('');
    } finally {
      setTimeout(() => setStatus({ type: '', message: '' }), 5000);
    }
  };

  const handleDisconnect = async (provider) => {
    try {
      await fetch(`${API_URL}/api/oauth/disconnect/${provider}`, {
        method: 'POST',
        headers: { 'X-User-Email': userEmail }
      });
      setStatus({ type: 'info', message: `Disconnected from ${provider}.` });
      await refreshOauthStatus();
    } catch (err) {
      console.error('Disconnect failed:', err);
    }
    setTimeout(() => setStatus({ type: '', message: '' }), 3000);
  };

  const handleReconnect = async (provider) => {
    await handleDisconnect(provider);
    setTimeout(() => handleConnect(provider), 500);
  };

  return { status, connecting, handleConnect, handleDisconnect, handleReconnect };
}
