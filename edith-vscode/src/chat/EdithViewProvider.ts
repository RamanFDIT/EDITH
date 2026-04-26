import * as vscode from 'vscode';
import { randomUUID } from 'node:crypto';
import { getApiUrl, getUserEmail, requireUserEmail } from '../auth/credentials';
import type { IdeContext } from './api';

type IncomingMessage =
  | { type: 'ready' }
  | { type: 'requestSignIn' }
  | { type: 'openExternal'; url: string }
  | { type: 'getIdeContext' }
  | { type: 'turnEnded' }
  | { type: 'log'; level: 'info' | 'warn' | 'error'; message: string };

export type ViewProviderHooks = {
  buildIdeContext: () => Promise<IdeContext>;
  onTurnEnded?: () => void;
};

type OutgoingMessage =
  | { type: 'bootstrap'; email: string; apiUrl: string; activeProjectId: string; predictionEnabled: boolean }
  | { type: 'ideContext'; context: IdeContext }
  | { type: 'commitDetected'; sha: string; branch: string; message: string; refs: string[] }
  | { type: 'predictionResult'; suggestions: Array<{ action: string; prompt: string; confidence: number }> }
  | { type: 'injectPrompt'; prompt: string; auto?: boolean }
  | { type: 'configChanged'; key: string; value: unknown };

export class EdithViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewId = 'edith.chat';

  private view?: vscode.WebviewView;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly hooks: ViewProviderHooks
  ) {}

  resolveWebviewView(view: vscode.WebviewView): void {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview')]
    };
    view.webview.html = this.renderHtml(view.webview);

    view.webview.onDidReceiveMessage(async (msg: IncomingMessage) => {
      switch (msg.type) {
        case 'ready':
          await this.bootstrap();
          break;
        case 'requestSignIn':
          await vscode.commands.executeCommand('edith.signIn');
          await this.bootstrap();
          break;
        case 'openExternal':
          if (msg.url) vscode.env.openExternal(vscode.Uri.parse(msg.url));
          break;
        case 'getIdeContext': {
          const ctx = await this.hooks.buildIdeContext();
          this.post({ type: 'ideContext', context: ctx });
          break;
        }
        case 'turnEnded':
          this.hooks.onTurnEnded?.();
          break;
        case 'log':
          // Surface webview logs in the extension host's output for easier debugging.
          // eslint-disable-next-line no-console
          console[msg.level === 'error' ? 'error' : msg.level === 'warn' ? 'warn' : 'log'](`[edith webview] ${msg.message}`);
          break;
      }
    });

    // Re-bootstrap whenever the user changes the API URL or sign-in state.
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration('edith')) {
        this.bootstrap().catch(() => undefined);
      }
    });
  }

  /** Show the chat view and inject a prompt (optionally auto-sending it). */
  async injectPrompt(prompt: string, auto = false): Promise<void> {
    await vscode.commands.executeCommand('edith.chat.focus');
    this.post({ type: 'injectPrompt', prompt, auto });
  }

  notifyCommit(payload: { sha: string; branch: string; message: string; refs: string[] }): void {
    this.post({ type: 'commitDetected', ...payload });
  }

  notifyPrediction(suggestions: Array<{ action: string; prompt: string; confidence: number }>): void {
    this.post({ type: 'predictionResult', suggestions });
  }

  private post(msg: OutgoingMessage): void {
    this.view?.webview.postMessage(msg);
  }

  private async bootstrap(): Promise<void> {
    const email = (await getUserEmail(this.context)) ?? '';
    const cfg = vscode.workspace.getConfiguration('edith');
    this.post({
      type: 'bootstrap',
      email,
      apiUrl: getApiUrl(),
      activeProjectId: cfg.get<string>('activeProjectId') ?? '',
      predictionEnabled: cfg.get<boolean>('predictionEnabled') ?? true
    });
  }

  private renderHtml(webview: vscode.Webview): string {
    const scriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'webview.js')
    );
    const styleUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview', 'webview.css')
    );
    const nonce = randomUUID().replace(/-/g, '');

    // CSP: only allow our bundled JS, our styles, and inline styles for component-scoped CSS.
    // Connect-src includes the configured API URL so SSE/fetch from the webview works.
    const apiUrl = getApiUrl();
    const csp = [
      `default-src 'none'`,
      `img-src ${webview.cspSource} https: data:`,
      `style-src ${webview.cspSource} 'unsafe-inline'`,
      `script-src 'nonce-${nonce}'`,
      `connect-src ${apiUrl} https: wss:`,
      `font-src ${webview.cspSource} https: data:`,
      `media-src ${webview.cspSource} https: data:`
    ].join('; ');

    return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta http-equiv="Content-Security-Policy" content="${csp}" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <link rel="stylesheet" href="${styleUri}" />
  <title>EDITH</title>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

export async function ensureSignedInOrPrompt(context: vscode.ExtensionContext): Promise<string | undefined> {
  return requireUserEmail(context, { promptIfMissing: true });
}
