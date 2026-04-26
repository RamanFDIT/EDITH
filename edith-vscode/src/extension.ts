import * as vscode from 'vscode';
import { clearUserEmail, getUserEmail, promptForSignIn } from './auth/credentials';
import { EdithViewProvider, ensureSignedInOrPrompt } from './chat/EdithViewProvider';
import { CommitWatcher, type CommitEvent } from './git/CommitWatcher';
import { generateCommitMessage } from './git/CommitMessageGen';
import { getGitApi } from './git/gitApi';
import type { IdeContext, Suggestion } from './chat/api';
import { PredictionLoop } from './prediction/PredictionLoop';

export async function activate(context: vscode.ExtensionContext): Promise<void> {
  const buildIdeContext = async (): Promise<IdeContext> => {
    const editor = vscode.window.activeTextEditor;
    const currentFile = editor
      ? vscode.workspace.asRelativePath(editor.document.uri, false)
      : undefined;
    let branch: string | undefined;
    try {
      const api = await getGitApi();
      if (api && api.repositories.length > 0) {
        // Match active editor to the right repo when possible.
        const activeUri = editor?.document.uri;
        const repo =
          (activeUri &&
            api.repositories.find((r) => activeUri.fsPath.startsWith(r.rootUri.fsPath))) ||
          api.repositories[0];
        branch = repo.state.HEAD?.name;
      }
    } catch {
      // ignore — branch is optional
    }
    const cfg = vscode.workspace.getConfiguration('edith');
    return {
      currentFile,
      branch,
      openTicketKey: cfg.get<string>('activeProjectId') || undefined
    };
  };

  // Forward declaration so the provider can call back into the prediction loop on turn end.
  let predictionLoop: PredictionLoop | undefined;

  const provider = new EdithViewProvider(context, {
    buildIdeContext,
    onTurnEnded: () => predictionLoop?.schedule({ reason: 'turn-end' }, 1000)
  });
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(EdithViewProvider.viewId, provider, {
      webviewOptions: { retainContextWhenHidden: true }
    })
  );

  const emitPrediction = (suggestions: Suggestion[]): void => {
    if (suggestions.length) provider.notifyPrediction(suggestions);
  };
  predictionLoop = new PredictionLoop(context, buildIdeContext, emitPrediction);
  context.subscriptions.push({ dispose: () => predictionLoop?.cancel() });

  const handleCommit = async (event: CommitEvent): Promise<void> => {
    const email = await getUserEmail(context);
    if (!email) return; // Quietly skip if not signed in.

    const subject = event.message.split('\n')[0];
    const refsHuman = event.refs
      .map((r) => (r.kind === 'github' ? `#${r.number}` : r.key))
      .join(' and ');
    const closingHints = event.refs
      .filter((r) => r.closing)
      .map((r) => (r.kind === 'github' ? `#${r.number}` : r.key));

    const followUp =
      `[IDE EVENT] I just committed \`${event.shortSha}\` on \`${event.branch}\`: "${subject}". ` +
      `It references ${refsHuman}.` +
      (closingHints.length
        ? ` The commit message uses closing keywords for ${closingHints.join(', ')}. ` +
          `Should I close those issues / move those tickets to Done? List the exact actions you'd take and wait for my confirmation.`
        : ` Should I close those, or leave them open? List the exact actions you'd take and wait for my confirmation.`);

    provider.notifyCommit({
      sha: event.shortSha,
      branch: event.branch,
      message: subject,
      refs: event.refs.map((r) =>
        r.kind === 'github' ? `#${r.number}` : r.key
      )
    });
    await provider.injectPrompt(followUp, true);

    predictionLoop?.schedule(
      {
        reason: 'commit',
        commitMessage: subject,
        refs: event.refs.map((r) => (r.kind === 'github' ? `#${r.number}` : r.key))
      },
      1500
    );
  };

  const commitWatcher = new CommitWatcher(context, (event) => {
    handleCommit(event).catch((err) => {
      // eslint-disable-next-line no-console
      console.error('[edith] commit handler failed:', err);
    });
  });
  context.subscriptions.push(commitWatcher);
  commitWatcher.start().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[edith] commit watcher start failed:', err);
  });

  // --- Commands ---

  context.subscriptions.push(
    vscode.commands.registerCommand('edith.signIn', async () => {
      await promptForSignIn(context);
    }),
    vscode.commands.registerCommand('edith.signOut', async () => {
      await clearUserEmail(context);
      vscode.window.showInformationMessage('EDITH signed out.');
    }),
    vscode.commands.registerCommand('edith.predictNow', async () => {
      const email = await ensureSignedInOrPrompt(context);
      if (!email) return;
      predictionLoop?.schedule({ reason: 'manual' }, 0);
    }),
    vscode.commands.registerCommand('edith.generateCommitMessage', async () => {
      await generateCommitMessage(context);
    })
  );

  // First-run nudge (non-blocking).
  const email = await getUserEmail(context);
  if (!email) {
    vscode.window
      .showInformationMessage(
        'EDITH: sign in to start chatting in your IDE.',
        'Sign In'
      )
      .then((choice) => {
        if (choice === 'Sign In') vscode.commands.executeCommand('edith.signIn');
      });
  }
}

export function deactivate(): void {
  // Subscriptions handle their own cleanup.
}
