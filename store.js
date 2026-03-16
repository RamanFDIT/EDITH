import Store from 'electron-store';

const electron = global.__electron || {};
const app = electron.app;
const safeStorage = electron.safeStorage;

// Wait for Electron app to be ready before initializing store 
// so safeStorage is available for synchronous module imports.
if (app) {
    await app.whenReady();
}

const SENSITIVE_KEYS = [
    'OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'JIRA_API_TOKEN', 
    'SLACK_BOT_TOKEN', 'SLACK_APP_TOKEN', 'GITHUB_PERSONAL_ACCESS_TOKEN', 
    'FIGMA_ACCESS_TOKEN', 'GOOGLE_CLIENT_ID', 'GOOGLE_CLIENT_SECRET', 'GOOGLE_REFRESH_TOKEN',
    'oauth_google', 'oauth_github', 'oauth_slack', 'oauth_figma', 'oauth_jira'
];

class SecureStore {
    constructor() {
        this._store = new Store({
            name: 'edith-config',
            projectName: 'EDITH',
            defaults: {
                // LLM Provider: 'auto' (detect), 'github', 'gemini', or 'ollama'
                LLM_PROVIDER: 'auto',
                GITHUB_MODEL: 'gpt-4o',
                OLLAMA_MODEL: 'llama3.2',
                OLLAMA_BASE_URL: 'http://localhost:11434',

                // Legacy API key fields (optional fallback — OAuth is the primary auth method)
                OPENAI_API_KEY: '',
                ELEVENLABS_API_KEY: '',
                JIRA_API_TOKEN: '',
                JIRA_EMAIL: '',
                JIRA_DOMAIN: '',
                SLACK_BOT_TOKEN: '',
                SLACK_APP_TOKEN: '',
                GITHUB_PERSONAL_ACCESS_TOKEN: '',
                FIGMA_ACCESS_TOKEN: '',
                GOOGLE_CLIENT_ID: '',
                GOOGLE_CLIENT_SECRET: '',
                GOOGLE_REFRESH_TOKEN: '',

                // OAuth2.0 tokens (populated automatically by oauthService.js)
                oauth_google: null,
                oauth_github: null,
                oauth_slack: null,
                oauth_figma: null,
                oauth_jira: null,

                // Setup flow flag
                setupComplete: false,
            }
        });

        this._migrate();
    }

    _isEncryptionAvailable() {
        return safeStorage && safeStorage.isEncryptionAvailable && safeStorage.isEncryptionAvailable();
    }

    _migrate() {
        // Only attempt migration if encryption is available
        if (!this._isEncryptionAvailable()) return;

        let migrated = false;
        const currentStore = this._store.store;
        
        for (const key of Object.keys(currentStore)) {
            if (SENSITIVE_KEYS.includes(key)) {
                const value = currentStore[key];
                // If it has a value and isn't already encrypted
                if (value && !(typeof value === 'string' && value.startsWith('edith_enc:'))) {
                    console.log(`[SecureStore] Auto-migrating plaintext value for ${key} to encrypted storage.`);
                    this.set(key, value); 
                    migrated = true;
                }
            }
        }
        
        if (migrated) {
            console.log('[SecureStore] Auto-migration to encrypted storage complete.');
        }
    }

    // Drop-in replacement for store.store (gets fully decrypted config object)
    get store() {
        const config = { ...this._store.store };
        for (const key of Object.keys(config)) {
             if (SENSITIVE_KEYS.includes(key)) {
                 config[key] = this.get(key);
             }
        }
        return config;
    }

    get(key, defaultValue = undefined) {
        let value = this._store.get(key, defaultValue);
        
        if (!SENSITIVE_KEYS.includes(key) || !value) {
            return value;
        }

        if (typeof value === 'string' && value.startsWith('edith_enc:')) {
            if (this._isEncryptionAvailable()) {
                try {
                    const buffer = Buffer.from(value.slice(10), 'hex');
                    const decrypted = safeStorage.decryptString(buffer);
                    return JSON.parse(decrypted);
                } catch (err) {
                    console.error(`[SecureStore] Failed to decrypt ${key}:`, err);
                    return defaultValue;
                }
            } else {
                console.warn(`[SecureStore] Cannot decrypt ${key}: safeStorage unavailable.`);
                return defaultValue; 
            }
        }

        // Return plaintext or raw object if not encrypted (e.g. fallback mode)
        return value;
    }

    set(key, value) {
        // Handle batch updates: store.set({ key1: val1, key2: val2 })
        if (typeof key === 'object' && key !== null) {
            for (const k of Object.keys(key)) {
                this.set(k, key[k]);
            }
            return;
        }

        if (SENSITIVE_KEYS.includes(key) && value) {
            if (this._isEncryptionAvailable()) {
                try {
                    const stringified = JSON.stringify(value);
                    const encryptedBuffer = safeStorage.encryptString(stringified);
                    const encryptedString = 'edith_enc:' + encryptedBuffer.toString('hex');
                    this._store.set(key, encryptedString);
                    return;
                } catch (err) {
                    console.error(`[SecureStore] Failed to encrypt ${key}:`, err);
                }
            }
        }
        
        // Fallback or non-sensitive
        this._store.set(key, value);
    }
}

const secureStore = new SecureStore();
export default secureStore;