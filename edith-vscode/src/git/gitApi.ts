import * as vscode from 'vscode';

// Minimal subset of the vscode.git extension API we depend on.
// Full types live in https://github.com/microsoft/vscode/blob/main/extensions/git/src/api/git.d.ts
export interface GitRepositoryState {
  HEAD?: { commit?: string; name?: string };
  onDidChange: vscode.Event<void>;
}

export interface GitRepository {
  rootUri: vscode.Uri;
  state: GitRepositoryState;
  inputBox: { value: string };
  getCommit(ref: string): Promise<{ hash: string; message: string; parents: string[] }>;
  diff(cached?: boolean): Promise<string>;
}

export interface GitApi {
  readonly state: 'uninitialized' | 'initialized';
  readonly repositories: GitRepository[];
  readonly onDidOpenRepository: vscode.Event<GitRepository>;
  readonly onDidChangeState: vscode.Event<'uninitialized' | 'initialized'>;
}

interface GitExtensionExports {
  getAPI(version: 1): GitApi;
}

export async function getGitApi(): Promise<GitApi | undefined> {
  const ext = vscode.extensions.getExtension<GitExtensionExports>('vscode.git');
  if (!ext) return undefined;
  if (!ext.isActive) await ext.activate();
  const api = ext.exports.getAPI(1);
  if (api.state === 'initialized') return api;
  return new Promise<GitApi>((resolve) => {
    const sub = api.onDidChangeState((s) => {
      if (s === 'initialized') {
        sub.dispose();
        resolve(api);
      }
    });
  });
}
