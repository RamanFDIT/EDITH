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

  useEffect(() => {
    if (historyLoaded) return;
    const loadHistory = async () => {
      try {
        const res = await fetch(`http://localhost:3000/api/history?sessionId=user-1&limit=${MESSAGES_PER_PAGE}`);
        const data = await res.json();
        if (data.messages) {
          setMessages(data.messages.map(msg => ({ role: msg.type === 'human' ? 'user' : 'ai', content: msg.content })));
        }
      } catch (err) {} finally { setHistoryLoaded(true); }
    };
    loadHistory();
  }, [historyLoaded, setMessages, setHistoryLoaded]);

  useEffect(() => {
    if (!loadingOlder) messageEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loadingOlder]);

  const handleSubmit = async () => {
    const question = input.trim();
    if (!question || isStreaming) return;
    setMessages(prev => [...prev, { role: 'user', content: question }]);
    setInput('');
    setIsStreaming(true);
    setMessages(prev => [...prev, { role: 'ai', content: '' }]);
    try {
      const res = await fetch('http://localhost:3000/api/ask', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ question }),
      });
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let accumulated = "";
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value);
        const lines = chunk.split('\n');
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.substring(6));
            if (data.type === 'token') {
              accumulated += data.content;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1].content = accumulated;
                return updated;
              });
            }
          }
        }
      }
    } catch (err) {} finally { setIsStreaming(false); }
  };

  return (
    <section className={styles.mainSection}>
      <div className={expanded ? styles.container : styles.containerCompact}>
        <div className={styles.messageArea} ref={messageAreaRef}>
          {messages.map((msg, i) =>
            msg.role === 'user' ? <ChatHuman key={i} message={msg.content} /> : <ChatAI key={i} message={msg.content} />
          )}
          <div ref={messageEndRef} />
        </div>
        <div className={styles.inputArea}>
          <Input value={input} onChange={setInput} onSubmit={handleSubmit} disabled={isStreaming} />
          <button className={styles.voiceToggle} onClick={() => setVoiceEnabled(!voiceEnabled)}>
            {voiceEnabled ? <Volume2 size={18} /> : <VolumeX size={18} />}
          </button>
        </div>
      </div>
    </section>
  );
};

export default Home;
