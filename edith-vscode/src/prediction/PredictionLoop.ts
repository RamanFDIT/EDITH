import * as vscode from 'vscode';
import { askForText, parseSuggestions, type IdeContext, type Suggestion } from '../chat/api';
import { getUserEmail } from '../auth/credentials';

type Trigger =
  | { reason: 'turn-end' }
  | { reason: 'commit'; commitMessage: string; refs: string[] }
  | { reason: 'manual' };

export class PredictionLoop {
  private inflight?: AbortController;
  private debounceTimer?: NodeJS.Timeout;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly buildIdeContext: () => Promise<IdeContext>,
    private readonly emit: (suggestions: Suggestion[]) => void
  ) {}

  /** Schedule a prediction request, debounced so rapid triggers collapse into one call. */
  schedule(trigger: Trigger, delayMs = 1000): void {
    if (!this.isEnabled()) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.run(trigger).catch((err) => {
        // eslint-disable-next-line no-console
        console.error('[edith] PredictionLoop failed:', err);
      });
    }, delayMs);
  }

  cancel(): void {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = undefined;
    this.inflight?.abort();
    this.inflight = undefined;
  }

  private async run(trigger: Trigger): Promise<void> {
    const email = await getUserEmail(this.context);
    if (!email) return;

    this.inflight?.abort();
    this.inflight = new AbortController();

    const ideContext = await this.buildIdeContext();
    const synthetic = this.buildPrompt(trigger);
    const cfg = vscode.workspace.getConfiguration('edith');

    try {
      const raw = await askForText(
        {
          email,
          question: synthetic,
          mode: 'predict',
          sessionId: 'ide-predict', // never persisted server-side under predict mode
          projectId: cfg.get<string>('activeProjectId') || undefined,
          ideContext
        },
        this.inflight.signal
      );
      const suggestions = parseSuggestions(raw);
      this.emit(suggestions);
    } catch (err) {
      if ((err as Error).name === 'AbortError') return;
      // eslint-disable-next-line no-console
      console.warn('[edith] prediction failed:', (err as Error).message);
    } finally {
      this.inflight = undefined;
    }
  }

  private buildPrompt(trigger: Trigger): string {
    switch (trigger.reason) {
      case 'commit':
        return (
          `[IDE EVENT] The user just made a commit. ` +
          `Suggest 1–3 likely next actions (e.g. open a PR, run tests, close the referenced issue, update the ticket). ` +
          `Commit message: ${trigger.commitMessage.slice(0, 400)}. ` +
          `Referenced: ${trigger.refs.join(', ') || 'none'}.`
        );
      case 'turn-end':
        return (
          `[IDE EVENT] Suggest 1–3 likely next actions the user might want, given the recent conversation and IDE context. ` +
          `Skip suggestions that duplicate what was just discussed.`
        );
      case 'manual':
      default:
        return `[IDE EVENT] Suggest 1–3 useful next actions for what the user is working on right now.`;
    }
  }

  private isEnabled(): boolean {
    return vscode.workspace.getConfiguration('edith').get<boolean>('predictionEnabled') ?? true;
  }
}
