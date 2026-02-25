import dotenv from 'dotenv';
import path from 'path';
import os from 'os';
import store from './store.js';

// 1. Try loading from the local project folder (Development)
// This looks for .env in the current working directory
dotenv.config();

// 2. Try loading from the User's Home Directory (Distribution)
// This allows you to share the .exe, and the user just needs to put their keys in their home folder.
// Windows: C:\Users\Username\.edith.env
// Mac/Linux: ~/.edith.env
const homeConfigPath = path.join(os.homedir(), '.edith.env');
dotenv.config({ path: homeConfigPath });

// 3. Load from electron-store (UI Settings)
const storeConfig = store.store;
for (const key in storeConfig) {
  if (storeConfig[key]) {
    process.env[key] = storeConfig[key];
  }
}

console.log(`[Config] Loaded environment. Checked: .env, ${homeConfigPath}, and electron-store`);
