import { app, BrowserWindow, ipcMain } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import store from './store.js';

// 1. IMPORT YOUR SERVER (This starts E.D.I.T.H.'s brain)
import './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;
let settingsWindow;

function createWindow() {
  // 2. CREATE THE DESKTOP WINDOW
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    title: "E.D.I.T.H. Tactical Interface",
    backgroundColor: '#0a0a0a', // Matches your CSS
    icon: path.join(__dirname, 'icon.png'), // (Optional) Add an icon later
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // 3. LOAD THE APP
  // Since server.js starts on port 3000, we load that URL
  mainWindow.loadURL('http://localhost:3000');

  // Hide the default menu bar for a cleaner "Jarvis" look
  mainWindow.setMenuBarVisibility(false);

  mainWindow.on('closed', function () {
    mainWindow = null;
  });
}

function createSettingsWindow() {
  if (settingsWindow) {
    settingsWindow.focus();
    return;
  }

  settingsWindow = new BrowserWindow({
    width: 800,
    height: 600,
    title: "E.D.I.T.H. Settings",
    backgroundColor: '#0a0a0a',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    }
  });

  // Load the React app (Vite dev server for now, or built files later)
  // In production, you'd load the built index.html from the frontend/dist folder
  const isDev = process.env.NODE_ENV !== 'production';
  if (isDev) {
    settingsWindow.loadURL('http://localhost:5173');
  } else {
    settingsWindow.loadFile(path.join(__dirname, 'frontend/dist/index.html'));
  }

  settingsWindow.setMenuBarVisibility(false);

  settingsWindow.on('closed', function () {
    settingsWindow = null;
  });
}

app.whenReady().then(() => {
  // Setup IPC handlers
  ipcMain.handle('get-config', () => {
    return store.store;
  });

  ipcMain.handle('save-config', (event, config) => {
    store.set(config);
    return true;
  });

  ipcMain.handle('open-settings', () => {
    createSettingsWindow();
  });

  ipcMain.handle('trigger-google-auth', () => {
    // TODO: Implement Google Auth flow
    console.log("Google Auth triggered from UI");
  });

  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});