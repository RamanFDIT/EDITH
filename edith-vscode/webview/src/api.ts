// Webview-side SSE client. Mirrors src/chat/api.ts in the extension host
// but reads its base URL + email from the bootstrap message instead of
// vscode.workspace settings (the webview can't see those directly).

export type IdeContext = {
  currentFile?: string;
  branch?: string;
  recentDiffSummary?: string;
  openTicketKey?: string;
};

export type SseEvent =
  | { type: 'token'; content: string }
  | { type: 'tool_start'; name: string; input: unknown }
  | { type: 'tool_end'; name: string; output: string }
  | { type: 'image'; url: string; caption?: string | null }
  | { type: 'audio'; url: string }
  | { type: 'tts_fallback'; text: string }
  | { type: 'heartbeat' }
  | { type: 'error'; message: string }
  | { type: 'done' };

export type AskParams = {
  apiUrl: string;
  email: string;
  question: string;
  sessionId?: string;
  projectId?: string;
  ideContext?: IdeContext;
  mode?: 'chat' | 'predict';
  signal?: AbortSignal;
};

export async function* streamAsk(p: AskParams): AsyncGenerator<SseEvent> {
  const url = `${p.apiUrl.replace(/\/$/, '')}/api/ask`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-User-Email': p.email
    },
    body: JSON.stringify({
      question: p.question,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      voiceEnabled: false,
      sessionId: p.sessionId ?? 'session-general',
      projectId: p.projectId,
      ideContext: p.ideContext,
      mode: p.mode ?? 'chat'
    }),
    signal: p.signal
  });

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/api/ask returned ${res.status}: ${text || res.statusText}`);
  }
  if (!res.body) throw new Error('/api/ask returned no body');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let split: number;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      try {
        yield JSON.parse(dataLine.slice(6)) as SseEvent;
      } catch {
        // ignore malformed event
      }
    }
  }
}
