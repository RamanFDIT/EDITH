// CJS bootstrap — Electron's main process starts here.
// Electron's built-in 'electron' module is only available via require() in CJS.
// The npm "electron" package is just a stub that returns the exe path.
// To make ESM files (main.js, oauthService.js) able to use Electron APIs,
// we expose them as a global before loading any ESM code.
global.__electron = require('electron');

import('./main.js').catch(async (err) => {
  console.error('[CRITICAL] Failed to load main.js:', err);

  // Write crash log so the user can diagnose
  try {
    const fs = require('fs');
    const path = require('path');
    const logPath = path.join(require('os').homedir(), 'edith-crash.log');
    fs.writeFileSync(logPath, `[${new Date().toISOString()}] CRITICAL: Failed to load main.js\n${err.stack || err}\n`);
    console.error(`[CRITICAL] Crash log written to ${logPath}`);
  } catch (_) { /* best-effort */ }

  // Show a dialog so the user sees the error instead of a silent exit
  try {
    const { app, dialog } = global.__electron;
    await app.whenReady();
    await dialog.showMessageBox({
      type: 'error',
      title: 'E.D.I.T.H. — Startup Error',
      message: 'Failed to start E.D.I.T.H.',
      detail: String(err.stack || err),
    });
  } catch (_) { /* best-effort */ }

  process.exit(1);
});
