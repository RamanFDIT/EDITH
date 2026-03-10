const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Legacy config
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  openSettings: () => ipcRenderer.invoke('open-settings'),

  // OAuth2.0
  oauthConnect: (provider) => ipcRenderer.invoke('oauth-connect', provider),
  oauthDisconnect: (provider) => ipcRenderer.invoke('oauth-disconnect', provider),
  oauthStatus: () => ipcRenderer.invoke('oauth-status'),

  // Legacy alias
  triggerGoogleAuth: () => ipcRenderer.invoke('trigger-google-auth'),
});