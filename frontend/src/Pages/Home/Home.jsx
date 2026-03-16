import { useState, useRef, useEffect, useCallback } from 'react';
import { Volume2, VolumeX } from 'lucide-react';
import styles from './Home.module.css';
import ChatAI from '../../components/ChatAI/ChatAI.jsx';
import ChatHuman from '../../components/ChatHuman/ChatHuman.jsx';
import Input from '../../components/Input/Input.jsx';

import { useNavBar } from '../../components/NavBar/NavBarContext.jsx';
import { useApp } from '../../context/AppContext.jsx';

const MESSAGES_PER_PAGE = 20;

const Home = () => {
  const { expanded } = useNavBar();
  const { messages, setMessages, historyLoaded, setHistoryLoaded } = useApp();
  const [input, setInput] = useState('');
  const [isStreaming, setIsStreaming] = useState(false);
  const [files, setFiles] = useState([]);
  const [hasMore, setHasMore] = useState(true);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const messageEndRef = useRef(null);
  const topSentinelRef = useRef(null);
  const messageAreaRef = useRef(null);
  const audioQueueRef = useRef([]);
  const isPlayingRef = useRef(false);

  // --- Audio playback queue (plays audio chunks sequentially) ---
  const playNextAudio = useCallback(() => {
    if (audioQueueRef.current.length === 0) {
      isPlayingRef.current = false;
      return;
    }
    isPlayingRef.current = true;
    const item = audioQueueRef.current.shift();

    if (item.type === 'url') {
      const audio = new Audio(item.url);
      audio.onended = playNextAudio;
      audio.onerror = playNextAudio;
      audio.play().catch(playNextAudio);
    } else if (item.type === 'speech') {
      const utterance = new SpeechSynthesisUtterance(item.text);
      utterance.lang = 'en-GB';
      utterance.rate = 1.0;
      utterance.onend = playNextAudio;
      utterance.onerror = playNextAudio;
      window.speechSynthesis.speak(utterance);
    }
  }, []);

  const enqueueAudio = useCallback((item) => {
    if (!voiceEnabled) return;
    audioQueueRef.current.push(item);
    if (!isPlayingRef.current) playNextAudio();
  }, [voiceEnabled, playNextAudio]);

  // Load initial history on first mount
  useEffect(() => {
    if (historyLoaded) return;

    const loadHistory = async () => {
      try {
        const res = await fetch(`http://localhost:3000/api/history?sessionId=user-1&limit=${MESSAGES_PER_PAGE}`);
        const data = await res.json();
        if (data.messages && data.messages.length > 0) {
          const mapped = data.messages.map(msg => ({
            role: msg.type === 'human' ? 'user' : 'ai',
            content: msg.content,
          }));
          setMessages(mapped);
          setHasMore(data.hasMore);
        } else {
          setHasMore(false);
        }
      } catch (err) {
        console.error('Failed to load chat history:', err);
        setHasMore(false);
      } finally {
        setHistoryLoaded(true);
      }
    };
    loadHistory();
  }, [historyLoaded, setMessages, setHistoryLoaded]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    if (!loadingOlder) {
      messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }
  }, [messages, loadingOlder]);

  // Load older messages when scrolling to top
  const loadOlderMessages = useCallback(async () => {
    if (loadingOlder || !hasMore) return;
    setLoadingOlder(true);

    const area = messageAreaRef.current;
    const prevScrollHeight = area?.scrollHeight || 0;

    try {
      const res = await fetch(
        `http://localhost:3000/api/history?sessionId=user-1&offset=${messages.length}&limit=${MESSAGES_PER_PAGE}`
      );
      const data = await res.json();
      if (data.messages && data.messages.length > 0) {
        const mapped = data.messages.map(msg => ({
          role: msg.type === 'human' ? 'user' : 'ai',
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
  }, [messages.length, loadingOlder, hasMore, setMessages]);

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
    const res = await fetch('http://localhost:3000/api/upload', {
      method: 'POST',
      body: formData,
    });
    const data = await res.json();
    return data.files; // [{ originalName, path, size }]
  };

  const handleSubmit = async () => {
    const question = input.trim();
    if (!question || isStreaming) return;

    const attachedFiles = [...files];
    const fileNames = attachedFiles.map(f => f.name);

    setMessages(prev => [...prev, { role: 'user', content: question, files: fileNames }]);
    setInput('');
    setFiles([]);
    setIsStreaming(true);

    setMessages(prev => [...prev, { role: 'ai', content: '' }]);

    try {
      // Upload files first if any
      let uploadedFiles = null;
      if (attachedFiles.length > 0) {
        uploadedFiles = await uploadFiles(attachedFiles);
      }

      const res = await fetch('http://localhost:3000/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question, files: uploadedFiles }),
      });

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;
          const data = JSON.parse(line.slice(6));

          if (data.type === 'token') {
            setMessages(prev => {
              const updated = [...prev];
              const last = updated[updated.length - 1];
              if (last.role === 'ai') {
                updated[updated.length - 1] = { ...last, content: last.content + data.content };
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
            // Edge TTS audio file — play it
            const fullUrl = data.url.startsWith('data:') ? data.url : `http://localhost:3000${data.url}`;
            enqueueAudio({ type: 'url', url: fullUrl });
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
          } else if (data.type === 'done') {
            break;
          }
        }
      }
    } catch (err) {
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last.role === 'ai' && last.content === '') {
          updated[updated.length - 1] = { ...last, content: 'Failed to get a response. Is the server running?' };
        }
        return updated;
      });
    } finally {
      setIsStreaming(false);
    }
  };

  // --- Handle voice input: read SSE stream from /api/voice ---
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
          const data = JSON.parse(line.slice(6));

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
            const fullUrl = data.url.startsWith('data:') ? data.url : `http://localhost:3000${data.url}`;
            enqueueAudio({ type: 'url', url: fullUrl });
          } else if (data.type === 'tts_fallback') {
            enqueueAudio({ type: 'speech', text: data.text });
          } else if (data.type === 'error') {
            console.error('[Voice] Stream error:', data.content);
          } else if (data.type === 'done') {
            break;
          }
        }
      }
    } catch (err) {
      console.error('[Voice] Stream read error:', err);
    }
  }, [setMessages, enqueueAudio]);

  return (
    <section className={styles.mainSection}>
      <div className={expanded ? styles.container : styles.containerCompact}>
        {messages.length === 0 && historyLoaded ? (
          <div className={styles.emptyState}>
            <p className={styles.emptyTitle}>What can I help you with?</p>
            <p className={styles.emptySubtitle}>Ask E.D.I.T.H. to manage your tools, create tickets, or check your schedule.</p>
          </div>
        ) : (
          <div className={styles.messageArea} ref={messageAreaRef}>
            {hasMore && <div ref={topSentinelRef} style={{ height: 1 }} />}
            {loadingOlder && <p className={styles.loadingText}>Loading older messages...</p>}
            {messages.map((msg, i) =>
              msg.role === 'user'
                ? <ChatHuman key={i} message={msg.content} files={msg.files} />
                : <ChatAI key={i} message={msg.content} images={msg.images} />
            )}
            <div ref={messageEndRef} />
          </div>
        )}
        <div className={styles.inputArea}>
          <div className={styles.inputRow}>
            <Input
              value={input}
              onChange={setInput}
              onSubmit={handleSubmit}
              disabled={isStreaming}
              files={files}
              onFilesChange={setFiles}
              onVoiceStream={handleVoiceStream}
            />
            <button
              className={`${styles.voiceToggle} ${voiceEnabled ? styles.voiceOn : ''}`}
              onClick={() => {
                setVoiceEnabled(v => !v);
                if (voiceEnabled) {
                  // Turning off — stop any current speech
                  window.speechSynthesis?.cancel();
                  audioQueueRef.current = [];
                  isPlayingRef.current = false;
                }
              }}
              title={voiceEnabled ? "Mute voice responses" : "Enable voice responses"}
            >
              {voiceEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};

export default Home;

