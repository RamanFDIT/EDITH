import { useState, useRef, useEffect, useCallback } from 'react';
import { useParams } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import styles from './Home.module.css';
import ChatAI from '../../components/ChatAI/ChatAI.jsx';
import ChatHuman from '../../components/ChatHuman/ChatHuman.jsx';
import Input from '../../components/Input/Input.jsx';
import { ease, durations } from '../../lib/motion.js';

import { useNavBar } from '../../components/NavBar/NavBarContext.jsx';
import { useApp } from '../../context/AppContext.jsx';
import { API_URL } from '../../apiConfig.js';

const MESSAGES_PER_PAGE = 20;

const Home = () => {
  const { id: projectIdFromUrl } = useParams();
  const { expanded } = useNavBar();
  const { userEmail, messages, setMessages, historyLoaded, setHistoryLoaded, activeSessionId, activeProject, activeProjectId, setActiveProjectId, pendingMessage, setPendingMessage } = useApp();

  // Sync active project from URL param
  useEffect(() => {
    if (projectIdFromUrl && projectIdFromUrl !== activeProjectId) {
      setActiveProjectId(projectIdFromUrl);
    }
  }, [projectIdFromUrl, activeProjectId, setActiveProjectId]);
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [files, setFiles] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [isThinking, setIsThinking] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(() => {
    const saved = localStorage.getItem('edithVoiceEnabled');
    return saved !== null ? JSON.parse(saved) : false;
  });

  const voiceEnabledRef = useRef(voiceEnabled);

  useEffect(() => {
    voiceEnabledRef.current = voiceEnabled;
    localStorage.setItem('edithVoiceEnabled', JSON.stringify(voiceEnabled));
  }, [voiceEnabled]);

  const messageEndRef = useRef(null);
  const topSentinelRef = useRef(null);
  const messageAreaRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);
  const currentAudioRef = useRef(null);
  const streamAbortRef = useRef(null);

  // --- Audio playback queue (plays audio chunks sequentially) ---
  const playNextAudio = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      currentAudioRef.current = null;
      return;
    }
    isPlayingRef.current = true;
    const item = audioQueueRef.current.shift();
    console.log('[Audio] Playing:', item.type === 'url' ? item.url.substring(0, 50) + '...' : 'Web Speech');

    if (item.type === 'url') {
      const audio = new Audio(item.url);
      currentAudioRef.current = audio;
      audio.onended = () => {
        if (currentAudioRef.current === audio) currentAudioRef.current = null;
        playNextAudio();
      };
      audio.onerror = (e) => {
        console.error('[Audio] Playback error:', e);
        if (currentAudioRef.current === audio) currentAudioRef.current = null;
        playNextAudio();
      };
      audio.play().catch(err => {
        console.warn('[Audio] Autoplay blocked or error:', err);
        if (currentAudioRef.current === audio) currentAudioRef.current = null;
        playNextAudio();
      });
    } else if (item.type === 'speech') {
      const utterance = new SpeechSynthesisUtterance(item.text);
      utterance.lang = 'en-GB';
      utterance.rate = 1.0;
      utterance.onend = playNextAudio;
      utterance.onerror = playNextAudio;
      window.speechSynthesis.speak(utterance);
    }
  }, []);

  const stopAudioPlayback = useCallback(() => {
    audioQueueRef.current = [];
    const active = currentAudioRef.current;
    if (active) {
      try {
        active.pause();
        active.src = '';
      } catch {
        // no-op
      }
      currentAudioRef.current = null;
    }
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    isPlayingRef.current = false;
  }, []);

  const enqueueAudio = useCallback((item) => {
    if (!voiceEnabledRef.current) {
      console.log('[Audio] Voice disabled, skipping:', item.type === 'url' ? item.url : 'Web Speech');
      return;
    }
    console.log('[Audio] Enqueuing:', item.type === 'url' ? item.url : 'Web Speech');
    audioQueueRef.current.push(item);
    if (!isPlayingRef.current) playNextAudio();
  }, [playNextAudio]);

  // Cut in-flight audio as soon as voice is switched off
  useEffect(() => {
    if (!voiceEnabled) stopAudioPlayback();
  }, [voiceEnabled, stopAudioPlayback]);

  // Cleanup audio queue on unmount
  useEffect(() => {
    return () => {
      stopAudioPlayback();
    };
  }, [stopAudioPlayback]);

  // Load chat history on mount and when session changes
  useEffect(() => {
    // Wait until activeProjectId is synced with URL param to avoid loading wrong session
    if (projectIdFromUrl && projectIdFromUrl !== activeProjectId) return;

    setHistoryLoaded(false);
    setMessages([]);
    setHasMore(true);

    const controller = new AbortController();

    const loadHistory = async () => {
      try {
        const res = await fetch(`${API_URL}/api/history?sessionId=${activeSessionId}&limit=${MESSAGES_PER_PAGE}`, {
            headers: { 'X-User-Email': userEmail },
            signal: controller.signal,
        });
        const data = await res.json();
        if (data.messages && data.messages.length > 0) {
          const mapped = data.messages.map(msg => ({
            role: (msg.role === 'user' || msg.type === 'human') ? 'user' : 'ai',
            content: msg.content,
          }));
          setMessages(mapped);
          setHasMore(data.hasMore);
        } else {
          setHasMore(false);
        }
      } catch (err) {
        if (err.name === 'AbortError') return;
        console.error('Failed to load chat history:', err);
        setHasMore(false);
      } finally {
        if (!controller.signal.aborted) {
          setHistoryLoaded(true);
        }
      }
    };
    loadHistory();

    return () => controller.abort();
  }, [setMessages, setHistoryLoaded, userEmail, activeSessionId, activeProjectId, projectIdFromUrl]);

  // Auto-submit pending message (from ProjectDashboard quick chat)
  const pendingHandledRef = useRef(false);
  useEffect(() => {
    if (pendingMessage && historyLoaded && !isStreaming && !pendingHandledRef.current) {
      pendingHandledRef.current = true;
      const msg = pendingMessage;
      setPendingMessage('');
      handleSubmit(msg);
    }
    if (!pendingMessage) {
      pendingHandledRef.current = false;
    }
  }, [pendingMessage, historyLoaded, isStreaming]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!loadingOlder) {
      messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loadingOlder]);

  // Load older messages when scrolling to top
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasMore || !historyLoaded) return;
    setLoadingOlder(true);

    const area = messageAreaRef.current;
    const prevScrollHeight = area?.scrollHeight || 0;

    try {
      const res = await fetch(
        `${API_URL}/api/history?sessionId=${activeSessionId}&offset=${messages.length}&limit=${MESSAGES_PER_PAGE}`,
        { headers: { 'X-User-Email': userEmail } }
      );
      const data = await res.json();
      if (data.messages && data.messages.length > 0) {
        const mapped = data.messages.map(msg => ({
          role: (msg.role === 'user' || msg.type === 'human') ? 'user' : 'ai',
          content: msg.content,
        }));
        setMessages(prev => [...mapped, ...prev]);
        setHasMore(data.hasMore);

        // Preserve scroll position after prepending
        requestAnimationFrame(() => {
          if (area) {
            area.scrollTop = area.scrollHeight - prevScrollHeight;
          }
        });
      } else {
        setHasMore(false);
      }
    } catch (err) {
      console.error('Failed to load older messages:', err);
    } finally {
      setLoadingOlder(false);
    }
  }, [messages.length, loadingOlder, hasMore, historyLoaded, setMessages, userEmail, activeSessionId]);

  // Intersection observer for scroll-to-load-older
  useEffect(() => {
    const sentinel = topSentinelRef.current;
    if (!sentinel) return;
    const observer = new IntersectionObserver(
      ([entry]) => { if (entry.isIntersecting) loadOlderMessages(); },
      { threshold: 0.1 }
    );
    observer.observe(sentinel);
    return () => observer.disconnect();
  }, [loadOlderMessages]);

  const uploadFiles = async (fileList) => {
    const formData = new FormData();
    fileList.forEach(f => formData.append('files', f));
    const res = await fetch(`${API_URL}/api/upload`, {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    return data.files; // [{ originalName, path, size }]
  };

  const isSubmittingRef = useRef(false);

  const handleSubmit = async (overrideText) => {
    if (isSubmittingRef.current) return;

    const question = typeof overrideText === 'string' ? overrideText.trim() : input.trim();
    if (!question || isStreaming) return;

    isSubmittingRef.current = true;
    stopAudioPlayback();

    const attachedFiles = [...files];
    const fileNames = attachedFiles.map(f => f.name);

    setMessages(prev => [...prev, { role: 'user', content: question, files: fileNames }]);
    setInput('');
    setFiles([]);
    setIsStreaming(true);
    setIsThinking(true);

    const streamAbort = new AbortController();
    streamAbortRef.current = streamAbort;
    const STREAM_INACTIVITY_MS = 60000;
    let inactivityTimer = setTimeout(() => streamAbort.abort(), STREAM_INACTIVITY_MS);

    try {
      // Upload files first if any
      let uploadedFiles = null;
      if (attachedFiles.length > 0) {
        uploadedFiles = await uploadFiles(attachedFiles);
      }
      const resetInactivity = () => {
        clearTimeout(inactivityTimer);
        inactivityTimer = setTimeout(() => streamAbort.abort(), STREAM_INACTIVITY_MS);
      };

      const res = await fetch(`${API_URL}/api/ask`, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'X-User-Email': userEmail
        },
        body: JSON.stringify({
          question,
          files: uploadedFiles,
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          voiceEnabled,
          sessionId: activeSessionId,
          projectId: activeProject?._id || null,
        }),
        signal: streamAbort.signal,
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        resetInactivity();

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let data;
          try {
            data = JSON.parse(line.slice(6));
          } catch (parseErr) {
            console.error('[Stream] JSON parse error:', parseErr, 'Line preview:', line.substring(0, 100));
            continue;
          }

          if (data.type === 'token') {
            setIsThinking(prev => {
              if (prev) return false;
              return prev;
            });
            setMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last?.role === 'ai') {
                updated[updated.length - 1] = { ...last, content: last.content + data.content };
              } else {
                updated.push({ role: 'ai', content: data.content });
              }
              return updated;
            });
          } else if (data.type === 'image') {
            setMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last.role === 'ai') {
                const images = [...(last.images || []), { url: data.url, caption: data.caption }];
                updated[updated.length - 1] = { ...last, images };
              }
              return updated;
            });
          } else if (data.type === 'audio') {
            // Edge TTS audio data (Base64) — play it
            enqueueAudio({ type: 'url', url: data.url });
          } else if (data.type === 'tts_fallback') {
            // Web Speech API fallback
            enqueueAudio({ type: 'speech', text: data.text });
          } else if (data.type === 'error') {
            setMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last.role === 'ai') {
                updated[updated.length - 1] = { ...last, content: last.content + `\n\n**Error:** ${data.content}` };
              }
              return updated;
            });
          } else if (data.type === 'heartbeat') {
            // Keepalive from server — inactivity timer already reset by resetInactivity() above
          } else if (data.type === 'done') {
            // Unblock UI immediately — audio may still arrive after this
            setIsStreaming(false);
            setIsThinking(false);
          }
        }
      }
    } catch (err) {
      if (err.name === 'AbortError') {
        // User cancelled or inactivity timeout — append note only if AI had no content yet
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last?.role === 'ai' && last.content === '') {
            updated[updated.length - 1] = { ...last, content: '*Response cancelled.*' };
          }
          return updated;
        });
      } else {
        console.error('[Stream] Fetch or read error:', err);
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          const errorMsg = 'Failed to get a response. Is the server running?';
          if (last?.role === 'ai' && last.content === '') {
            updated[updated.length - 1] = { ...last, content: errorMsg };
          } else if (last?.role === 'ai') {
            updated[updated.length - 1] = { ...last, content: last.content + `\n\n*${errorMsg}*` };
          }
          return updated;
        });
      }
    } finally {
      clearTimeout(inactivityTimer);
      streamAbortRef.current = null;
      setIsStreaming(false);
      setIsThinking(false);
      isSubmittingRef.current = false;
    }
  };

  // --- Handle voice stream: read SSE stream from /api/voice ---
  const handleVoiceStream = useCallback(async (streamBody) => {
    const reader = streamBody.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let aiMsgAdded = false;

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          let data;
          try {
            data = JSON.parse(line.slice(6));
          } catch (parseErr) {
            console.error('[Voice] JSON parse error:', parseErr, 'Line preview:', line.substring(0, 100));
            continue;
          }

          if (data.type === 'user_text') {
            // Show what the user said in the chat immediately
            setMessages(prev => [...prev, { role: 'user', content: data.content }]);
          } else if (data.type === 'token') {
            if (!aiMsgAdded) {
              setMessages(prev => [...prev, { role: 'ai', content: '' }]);
              aiMsgAdded = true;
            }
            setMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last.role === 'ai') {
                updated[updated.length - 1] = { ...last, content: last.content + data.content };
              }
              return updated;
            });
          } else if (data.type === 'audio') {
            enqueueAudio({ type: 'url', url: data.url });
          } else if (data.type === 'tts_fallback') {
            enqueueAudio({ type: 'speech', text: data.text });
          } else if (data.type === 'error') {
            console.error('[Voice] Stream error:', data.content);
          } else if (data.type === 'done') {
            // Voice stream text complete — audio may still arrive
          }
        }
      }
    } catch (err) {
      console.error('[Voice] Stream read error:', err);
    }
  }, [setMessages, enqueueAudio]);

  // --- Handle audio submission: send blob to backend /api/voice for STT + response ---
  const handleAudioSubmit = useCallback(async (audioBlob) => {
    stopAudioPlayback();
    const voiceAbort = new AbortController();
    streamAbortRef.current = voiceAbort;
    setIsStreaming(true);
    setIsThinking(true);
    try {
      const formData = new FormData();
      formData.append('audio', audioBlob, 'recording.webm');
      formData.append('sessionId', activeSessionId);
      if (activeProject?._id) formData.append('projectId', activeProject._id);
      if (voiceEnabledRef.current) formData.append('voiceEnabled', 'true');

      const response = await fetch(`${API_URL}/api/voice`, {
        method: 'POST',
        headers: { 'X-User-Email': userEmail },
        body: formData,
        signal: voiceAbort.signal,
      });

      if (!response.ok) throw new Error(`Voice API returned ${response.status}`);
      await handleVoiceStream(response.body);
    } catch (err) {
      if (err.name !== 'AbortError') console.error('[AudioSubmit] Error:', err);
    } finally {
      streamAbortRef.current = null;
      setIsStreaming(false);
      setIsThinking(false);
    }
  }, [activeSessionId, activeProject, userEmail, handleVoiceStream, stopAudioPlayback]);

  // --- Cancel active stream ---
  const cancelStream = useCallback(() => {
    if (streamAbortRef.current) {
      streamAbortRef.current.abort();
      streamAbortRef.current = null;
    }
    stopAudioPlayback();
  }, [stopAudioPlayback]);

  return (
    <section className={styles.mainSection}>
      <div className={expanded ? styles.container : styles.containerCompact}>
        {!historyLoaded ? (
          <div className={styles.emptyState}>
            <p className={styles.emptySubtitle}>Loading...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyTitle}>What can I help you with?</p>
            <p className={styles.emptySubtitle}>Ask E.D.I.T.H. to manage your tools, create tickets, or check your schedule.</p>
          </div>
        ) : (
          <div className={styles.messageArea} ref={messageAreaRef}>
            {hasMore && <div ref={topSentinelRef} style={{ height: 1 }} />}
            {loadingOlder && <p className={styles.loadingText}>Loading older messages...</p>}
            {messages.map((msg, i) => {
              const isNewest = i === messages.length - 1;
              return (
                <motion.div
                  key={i}
                  initial={isNewest ? { opacity: 0, y: 8 } : false}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: durations.base, ease }}
                >
                  {msg.role === 'user'
                    ? <ChatHuman message={msg.content} files={msg.files} />
                    : <ChatAI message={msg.content} images={msg.images} />}
                </motion.div>
              );
            })}
            <AnimatePresence>
              {isThinking && (
                <motion.div
                  key="thinking"
                  className={styles.thinkingBubble}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: 2 }}
                  transition={{ duration: durations.fast, ease }}
                >
                  <span className={styles.thinkingDot} />
                  <span className={styles.thinkingDot} />
                  <span className={styles.thinkingDot} />
                </motion.div>
              )}
            </AnimatePresence>
            <div ref={messageEndRef} />
          </div>
        )}
        <div className={styles.inputArea}>
          <Input
            value={input}
            onChange={setInput}
            onSubmit={handleSubmit}
            disabled={isStreaming}
            files={files}
            onFilesChange={setFiles}
            onAudioSubmit={handleAudioSubmit}
            isStreaming={isStreaming}
            onCancel={cancelStream}
            voiceEnabled={voiceEnabled}
            onVoiceToggle={() => setVoiceEnabled(v => !v)}
          />
        </div>
      </div>
    </section>
  );
};

export default Home;
