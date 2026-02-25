const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  getConfig: () => ipcRenderer.invoke('get-config'),
  saveConfig: (config) => ipcRenderer.invoke('save-config', config),
  triggerGoogleAuth: () => ipcRenderer.invoke('trigger-google-auth'),
  openSettings: () => ipcRenderer.invoke('open-settings')
});