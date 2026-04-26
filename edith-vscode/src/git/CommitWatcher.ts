import * as vscode from 'vscode';
import { getGitApi, type GitApi, type GitRepository } from './gitApi';
import { extractIssueRefs, summarizeRefs, type IssueRef } from './issueRefs';

export type CommitEvent = {
  sha: string;
  shortSha: string;
  branch: string;
  message: string;
  refs: IssueRef[];
  refsSummary: string;
};

export class CommitWatcher implements vscode.Disposable {
  private readonly disposables: vscode.Disposable[] = [];
  private readonly lastSeenSha = new Map<string, string>();
  private api?: GitApi;

  constructor(
    private readonly context: vscode.ExtensionContext,
    private readonly onCommit: (event: CommitEvent) => void
  ) {}

  async start(): Promise<void> {
    const api = await getGitApi();
    if (!api) {
      vscode.window.showWarningMessage(
        'EDITH: VS Code Git extension not available — commit detection disabled.'
      );
      return;
    }
    this.api = api;
    api.repositories.forEach((repo) => this.attachToRepo(repo));
    this.disposables.push(api.onDidOpenRepository((repo) => this.attachToRepo(repo)));
  }

  private attachToRepo(repo: GitRepository): void {
    const key = repo.rootUri.toString();
    // Seed last-seen sha so we don't fire on activation for the existing HEAD.
    this.lastSeenSha.set(key, repo.state.HEAD?.commit ?? '');

    this.disposables.push(
      repo.state.onDidChange(() => {
        if (!this.isEnabled()) return;
        const head = repo.state.HEAD?.commit;
        const branch = repo.state.HEAD?.name ?? '';
        if (!head) return;
        const previous = this.lastSeenSha.get(key);
        if (head === previous) return;
        this.lastSeenSha.set(key, head);
        this.handleNewCommit(repo, head, branch).catch((err) => {
          // eslint-disable-next-line no-console
          console.error('[edith] CommitWatcher failed:', err);
        });
      })
    );
  }

  private async handleNewCommit(repo: GitRepository, sha: string, branch: string): Promise<void> {
    const commit = await repo.getCommit(sha).catch(() => undefined);
    if (!commit) return;
    const refs = extractIssueRefs(commit.message, branch);
    if (!refs.length) return; // Only surface commits that mention issues/tickets.
    this.onCommit({
      sha: commit.hash,
      shortSha: commit.hash.slice(0, 7),
      branch,
      message: commit.message,
      refs,
      refsSummary: summarizeRefs(refs)
    });
  }

  private isEnabled(): boolean {
    return vscode.workspace.getConfiguration('edith').get<boolean>('commitWatchEnabled') ?? true;
  }

  dispose(): void {
    this.disposables.forEach((d) => d.dispose());
    this.disposables.length = 0;
  }
}
