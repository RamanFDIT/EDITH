import dotenv from 'dotenv';
import bundledConfig from './bundledConfig.js';

// 0. Load bundled defaults (fallback if .env is missing)
for (const [key, value] of Object.entries(bundledConfig)) {
  if (value && !process.env[key]) {
    process.env[key] = value;
  }
}

// 1. Load from the project folder (Environment variables)
dotenv.config();

console.log(`[Config] Loaded environment variables from bundledConfig and .env`);
