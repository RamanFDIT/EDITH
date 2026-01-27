import { app, BrowserWindow } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';

// 1. IMPORT YOUR SERVER (This starts E.D.I.T.H.'s brain)
import './server.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow;

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
      contextIsolation: true
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

app.whenReady().then(() => {
  createWindow();

  app.on('activate', function () {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', function () {
  if (process.platform !== 'darwin') app.quit();
});