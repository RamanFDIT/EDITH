import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getVsCode } from './vscode';
import { streamAsk } from './api';

type ChatMessage = {
  id: string;
  role: 'user' | 'ai' | 'system';
  content: string;
  pending?: boolean;
};

type Bootstrap = {
  email: string;
  apiUrl: string;
  activeProjectId: string;
  predictionEnabled: boolean;
};

type Suggestion = { action: string; prompt: string; confidence: number };

type IncomingFromHost =
  | { type: 'bootstrap'; email: string; apiUrl: string; activeProjectId: string; predictionEnabled: boolean }
  | { type: 'commitDetected'; sha: string; branch: string; message: string; refs: string[] }
  | { type: 'predictionResult'; suggestions: Suggestion[] }
  | { type: 'injectPrompt'; prompt: string; auto?: boolean };

const newId = () => Math.random().toString(36).slice(2, 10);

export function App() {
  const vscode = useMemo(() => getVsCode(), []);
  const [bootstrap, setBootstrap] = useState<Bootstrap | undefined>();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [streaming, setStreaming] = useState(false);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const abortRef = useRef<AbortController | undefined>();
  const scrollRef = useRef<HTMLDivElement>(null);

  // Tell host we're alive.
  useEffect(() => {
    vscode.postMessage({ type: 'ready' });
  }, [vscode]);

  // Listen for messages from the extension host.
  useEffect(() => {
    const handler = (e: MessageEvent<IncomingFromHost>) => {
      const msg = e.data;
      switch (msg.type) {
        case 'bootstrap':
          setBootstrap({
            email: msg.email,
            apiUrl: msg.apiUrl,
            activeProjectId: msg.activeProjectId,
            predictionEnabled: msg.predictionEnabled
          });
          break;
        case 'commitDetected':
          setMessages((prev) => [
            ...prev,
            {
              id: newId(),
              role: 'system',
              content: `🔵 Commit \`${msg.sha}\` on \`${msg.branch}\` references ${msg.refs.join(', ') || 'no issues'} — "${msg.message}"`
            }
          ]);
          break;
        case 'predictionResult':
          setSuggestions(msg.suggestions ?? []);
          break;
        case 'injectPrompt':
          if (msg.auto) {
            void send(msg.prompt);
          } else {
            setInput(msg.prompt);
          }
          break;
      }
    };
    window.addEventListener('message', handler);
    return () => window.removeEventListener('message', handler);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bootstrap?.email, bootstrap?.apiUrl, bootstrap?.activeProjectId]);

  // Auto-scroll on new content.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages]);

  const send = useCallback(
    async (questionRaw: string) => {
      const question = questionRaw.trim();
      if (!question || !bootstrap?.email || streaming) return;

      const userMsg: ChatMessage = { id: newId(), role: 'user', content: question };
      const aiMsg: ChatMessage = { id: newId(), role: 'ai', content: '', pending: true };
      setMessages((prev) => [...prev, userMsg, aiMsg]);
      setInput('');
      setSuggestions([]);
      setStreaming(true);

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      try {
        for await (const event of streamAsk({
          apiUrl: bootstrap.apiUrl,
          email: bootstrap.email,
          question,
          projectId: bootstrap.activeProjectId || undefined,
          mode: 'chat',
          signal: ctrl.signal
        })) {
          if (event.type === 'token') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMsg.id ? { ...m, content: m.content + event.content } : m
              )
            );
          } else if (event.type === 'tool_start') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMsg.id
                  ? { ...m, content: m.content + `\n\n⚙️ _calling_ \`${event.name}\`…\n` }
                  : m
              )
            );
          } else if (event.type === 'error') {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === aiMsg.id ? { ...m, content: m.content + `\n\n❌ ${event.message}` } : m
              )
            );
          } else if (event.type === 'done') {
            break;
          }
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setMessages((prev) =>
          prev.map((m) =>
            m.id === aiMsg.id ? { ...m, content: m.content || `❌ ${msg}` } : m
          )
        );
      } finally {
        setMessages((prev) => prev.map((m) => (m.id === aiMsg.id ? { ...m, pending: false } : m)));
        setStreaming(false);
        abortRef.current = undefined;
        // Notify the host so it can fire a debounced prediction request.
        vscode.postMessage({ type: 'turnEnded' });
      }
    },
    [bootstrap, streaming, vscode]
  );

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    void send(input);
  };

  const cancel = () => {
    abortRef.current?.abort();
  };

  if (!bootstrap) {
    return <div className="loading">Loading EDITH…</div>;
  }

  if (!bootstrap.email) {
    return (
      <div className="signin">
        <h2>EDITH</h2>
        <p>Sign in with the email you use on the EDITH web app.</p>
        <button onClick={() => vscode.postMessage({ type: 'requestSignIn' })}>Sign In</button>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="title">EDITH</div>
        <div className="email" title={bootstrap.email}>
          {bootstrap.email}
        </div>
      </header>

      <div className="messages" ref={scrollRef}>
        {messages.length === 0 && (
          <div className="empty">
            Ask me anything. I can manage Jira, GitHub, Calendar, Gmail, Slack, and Figma.
          </div>
        )}
        {messages.map((m) => (
          <div key={m.id} className={`msg msg-${m.role}`}>
            <div className="role">{m.role === 'user' ? 'You' : m.role === 'ai' ? 'EDITH' : '·'}</div>
            <pre className="content">{m.content || (m.pending ? '…' : '')}</pre>
          </div>
        ))}
      </div>

      {suggestions.length > 0 && (
        <div className="suggestions">
          <div className="suggestions-label">Suggested next:</div>
          <div className="chips">
            {suggestions.map((s, i) => (
              <button
                key={i}
                className="chip"
                title={s.prompt}
                onClick={() => {
                  setSuggestions([]);
                  void send(s.prompt);
                }}
              >
                {s.action}
              </button>
            ))}
            <button className="chip chip-dismiss" onClick={() => setSuggestions([])}>
              dismiss
            </button>
          </div>
        </div>
      )}

      <form className="input" onSubmit={onSubmit}>
        <textarea
          rows={2}
          placeholder={streaming ? 'EDITH is responding…' : 'Message EDITH…'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          disabled={streaming}
        />
        <div className="input-actions">
          {streaming ? (
            <button type="button" onClick={cancel}>
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()}>
              Send
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
