import * as vscode from 'vscode';

const SECRET_KEY = 'edith.userEmail';

let cachedEmail: string | undefined;

export function getApiUrl(): string {
  return vscode.workspace.getConfiguration('edith').get<string>('apiUrl')
    || 'https://edith-4ihs.onrender.com';
}

export async function getUserEmail(context: vscode.ExtensionContext): Promise<string | undefined> {
  if (cachedEmail !== undefined) return cachedEmail || undefined;
  const stored = await context.secrets.get(SECRET_KEY);
  cachedEmail = stored ?? '';
  return stored;
}

export async function setUserEmail(context: vscode.ExtensionContext, email: string): Promise<void> {
  cachedEmail = email;
  await context.secrets.store(SECRET_KEY, email);
}

export async function clearUserEmail(context: vscode.ExtensionContext): Promise<void> {
  cachedEmail = '';
  await context.secrets.delete(SECRET_KEY);
}

export async function promptForSignIn(context: vscode.ExtensionContext): Promise<string | undefined> {
  const email = await vscode.window.showInputBox({
    title: 'EDITH — Sign In',
    prompt: 'Enter the email you use with EDITH on the web. OAuth tool connections (GitHub, Jira) carry over from the web app.',
    placeHolder: 'you@example.com',
    ignoreFocusOut: true,
    validateInput: (value) => {
      const trimmed = value.trim();
      if (!trimmed) return 'Email is required.';
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) return 'Enter a valid email address.';
      return undefined;
    }
  });
  if (!email) return undefined;
  const trimmed = email.trim().toLowerCase();
  await setUserEmail(context, trimmed);
  vscode.window.showInformationMessage(`EDITH signed in as ${trimmed}.`);
  return trimmed;
}

export async function requireUserEmail(
  context: vscode.ExtensionContext,
  { promptIfMissing = true }: { promptIfMissing?: boolean } = {}
): Promise<string | undefined> {
  const existing = await getUserEmail(context);
  if (existing) return existing;
  if (!promptIfMissing) return undefined;
  return promptForSignIn(context);
}

export function authHeaders(email: string): Record<string, string> {
  return { 'X-User-Email': email };
}
