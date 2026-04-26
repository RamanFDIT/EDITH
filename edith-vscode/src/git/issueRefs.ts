export type IssueRef =
  | { kind: 'github'; number: number; closing: boolean }
  | { kind: 'jira'; key: string; closing: boolean };

const GH_KEYWORD = /(close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s+#(\d+)/gi;
const GH_BARE = /(?<![A-Za-z0-9_])#(\d+)/g;
const JIRA_KEY = /\b([A-Z][A-Z0-9]+-\d+)\b/g;
const JIRA_KEYWORD = /(close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s+([A-Z][A-Z0-9]+-\d+)/gi;
const BRANCH_JIRA = /(?:^|\/)([A-Z][A-Z0-9]+-\d+)(?:[-/]|$)/;

/**
 * Extract GitHub issue numbers and Jira keys from a commit message + branch name.
 * `closing` is true when the reference appears with a closing keyword (close/fix/resolve).
 */
export function extractIssueRefs(commitMessage: string, branchName: string | undefined): IssueRef[] {
  const refs = new Map<string, IssueRef>();
  const text = `${commitMessage}\n${branchName ?? ''}`;

  for (const match of text.matchAll(GH_KEYWORD)) {
    const num = Number(match[2]);
    refs.set(`gh:${num}`, { kind: 'github', number: num, closing: true });
  }
  for (const match of text.matchAll(GH_BARE)) {
    const num = Number(match[1]);
    const key = `gh:${num}`;
    if (!refs.has(key)) refs.set(key, { kind: 'github', number: num, closing: false });
  }

  for (const match of text.matchAll(JIRA_KEYWORD)) {
    const k = match[2];
    refs.set(`jira:${k}`, { kind: 'jira', key: k, closing: true });
  }
  for (const match of text.matchAll(JIRA_KEY)) {
    const k = match[1];
    const key = `jira:${k}`;
    if (!refs.has(key)) refs.set(key, { kind: 'jira', key: k, closing: false });
  }

  // Branch-derived Jira reference (e.g. feature/EDITH-42-foo).
  if (branchName) {
    const branchMatch = branchName.match(BRANCH_JIRA);
    if (branchMatch) {
      const k = branchMatch[1];
      const key = `jira:${k}`;
      if (!refs.has(key)) refs.set(key, { kind: 'jira', key: k, closing: false });
    }
  }

  return Array.from(refs.values());
}

export function summarizeRefs(refs: IssueRef[]): string {
  if (!refs.length) return '';
  const parts = refs.map((r) =>
    r.kind === 'github'
      ? `#${r.number}${r.closing ? ' (closing)' : ''}`
      : `${r.key}${r.closing ? ' (closing)' : ''}`
  );
  return parts.join(', ');
}
