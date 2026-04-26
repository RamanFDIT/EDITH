import * as vscode from 'vscode';
import { askForText } from '../chat/api';
import { ensureSignedInOrPrompt } from '../chat/EdithViewProvider';
import { getGitApi } from './gitApi';

const MAX_DIFF_CHARS = 6000;

export async function generateCommitMessage(context: vscode.ExtensionContext): Promise<void> {
  const email = await ensureSignedInOrPrompt(context);
  if (!email) return;

  const api = await getGitApi();
  if (!api || api.repositories.length === 0) {
    vscode.window.showWarningMessage('EDITH: no Git repository open.');
    return;
  }

  // If multiple repos, prefer the one whose root is an ancestor of the active editor.
  let repo = api.repositories[0];
  const activeUri = vscode.window.activeTextEditor?.document.uri;
  if (activeUri) {
    const match = api.repositories.find((r) => activeUri.fsPath.startsWith(r.rootUri.fsPath));
    if (match) repo = match;
  }

  const diff = await repo.diff(true).catch(() => '');
  if (!diff.trim()) {
    vscode.window.showInformationMessage('EDITH: nothing staged. Stage your changes first.');
    return;
  }

  const truncated =
    diff.length > MAX_DIFF_CHARS ? diff.slice(0, MAX_DIFF_CHARS) + '\n\n[…diff truncated…]' : diff;

  const branch = repo.state.HEAD?.name ?? '';

  const prompt =
    `[IDE EVENT] Draft a commit message for the following staged diff. ` +
    `Output ONLY the message — no quotes, no markdown, no commentary. ` +
    `Format: a single conventional-commit subject line (≤72 chars), then a blank line, then a 2–3 line body explaining why the change was made. ` +
    `Branch: ${branch || '(none)'}.\n\n` +
    `\`\`\`diff\n${truncated}\n\`\`\``;

  await vscode.window.withProgress(
    {
      location: vscode.ProgressLocation.SourceControl,
      title: 'EDITH: drafting commit message…'
    },
    async () => {
      try {
        const text = await askForText({
          email,
          question: prompt,
          mode: 'chat',
          sessionId: 'ide-commit-msg', // ephemeral session to avoid polluting main chat
          ideContext: { branch, recentDiffSummary: truncated.slice(0, 1500) }
        });
        const cleaned = text
          .trim()
          .replace(/^```(?:\w+)?\n?/i, '')
          .replace(/\n?```$/, '')
          .trim();
        if (!cleaned) {
          vscode.window.showWarningMessage('EDITH returned an empty commit message.');
          return;
        }
        repo.inputBox.value = cleaned;
        vscode.window.showInformationMessage('EDITH: commit message ready in Source Control.');
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        vscode.window.showErrorMessage(`EDITH: commit message generation failed — ${msg}`);
      }
    }
  );
}
