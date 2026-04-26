import { getApiUrl, authHeaders } from '../auth/credentials';

export type IdeContext = {
  currentFile?: string;
  branch?: string;
  recentDiffSummary?: string;
  openTicketKey?: string;
};

export type AskRequest = {
  question: string;
  email: string;
  sessionId?: string;
  projectId?: string;
  timezone?: string;
  voiceEnabled?: boolean;
  ideContext?: IdeContext;
  mode?: 'chat' | 'predict';
  files?: Array<{ path: string; originalName: string }>;
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

export type Suggestion = { action: string; prompt: string; confidence: number };

/**
 * POST /api/ask and yield parsed SSE events. Caller drives the loop.
 *
 * Mirrors the parsing from frontend/src/Pages/Home/Home.jsx so the protocol
 * stays in lockstep with the web client.
 */
export async function* streamAsk(req: AskRequest, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const url = `${getApiUrl().replace(/\/$/, '')}/api/ask`;
  const body = {
    question: req.question,
    timezone: req.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
    voiceEnabled: req.voiceEnabled ?? false,
    sessionId: req.sessionId ?? 'session-general',
    projectId: req.projectId,
    ideContext: req.ideContext,
    mode: req.mode ?? 'chat',
    files: req.files
  };

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders(req.email)
    },
    body: JSON.stringify(body),
    signal
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`/api/ask returned ${response.status}: ${text || response.statusText}`);
  }
  if (!response.body) {
    throw new Error('/api/ask returned no body');
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE events are separated by a blank line.
    let split: number;
    while ((split = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, split);
      buffer = buffer.slice(split + 2);
      const dataLine = raw.split('\n').find((l) => l.startsWith('data: '));
      if (!dataLine) continue;
      const payload = dataLine.slice(6);
      try {
        yield JSON.parse(payload) as SseEvent;
      } catch {
        // Ignore malformed events rather than aborting the stream.
      }
    }
  }
}

/**
 * Convenience wrapper: collects only `token` content into a single string.
 * Used by predict mode and the commit-message generator.
 */
export async function askForText(req: AskRequest, signal?: AbortSignal): Promise<string> {
  let out = '';
  for await (const event of streamAsk(req, signal)) {
    if (event.type === 'token') out += event.content;
    if (event.type === 'done') break;
    if (event.type === 'error') throw new Error(event.message);
  }
  return out;
}

export function parseSuggestions(raw: string): Suggestion[] {
  // Predict mode tells the LLM to return raw JSON, but tolerate fenced code in case it slips.
  const trimmed = raw.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try {
    const parsed = JSON.parse(trimmed);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((s) => s && typeof s.prompt === 'string' && typeof s.action === 'string')
      .slice(0, 3)
      .map((s) => ({
        action: String(s.action),
        prompt: String(s.prompt),
        confidence: typeof s.confidence === 'number' ? s.confidence : 0.5
      }));
  } catch {
    return [];
  }
}

export async function checkSession(email: string, signal?: AbortSignal): Promise<boolean> {
  try {
    const url = `${getApiUrl().replace(/\/$/, '')}/api/auth/session`;
    const res = await fetch(url, {
      method: 'GET',
      headers: authHeaders(email),
      signal
    });
    return res.ok;
  } catch {
    return false;
  }
}
