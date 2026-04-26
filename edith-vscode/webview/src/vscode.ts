// Wrapper around acquireVsCodeApi() so we can call it once per webview lifetime.
declare global {
  interface Window {
    acquireVsCodeApi?: () => VsCodeApi;
  }
}

export interface VsCodeApi {
  postMessage(msg: unknown): void;
  getState<T = unknown>(): T | undefined;
  setState<T>(state: T): void;
}

let api: VsCodeApi | undefined;

export function getVsCode(): VsCodeApi {
  if (!api) {
    if (typeof window.acquireVsCodeApi !== 'function') {
      throw new Error('acquireVsCodeApi is not available — running outside VS Code?');
    }
    api = window.acquireVsCodeApi();
  }
  return api;
}
