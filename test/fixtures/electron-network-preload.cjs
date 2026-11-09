'use strict';
const { contextBridge, ipcRenderer } = require('electron');

// The smoke driver inserts the actual helper as source into this lexical CJS
// closure. Electron sandbox preloads cannot require arbitrary relative files.
const network = (() => {
  const module = { exports: {} };
  /* DSH_NETWORK_FACTORY_SOURCE */
  return module.exports.createDesktopNetworkBridge(ipcRenderer);
})();
const channel = 'power-dsh-browser:electron-network-smoke:v1';
contextBridge.exposeInMainWorld('ELECTRON_NETWORK_SMOKE', {
  network,
  environment: { sandboxed: process.sandboxed, contextIsolated: process.contextIsolated },
  acquire: () => ipcRenderer.invoke(channel, { operation: 'acquire' }),
  release: lease => ipcRenderer.invoke(channel, { operation: 'release', lease }),
  debugState: lease => ipcRenderer.invoke(channel, { operation: 'debug-state', lease }),
  occupyDebugger: lease => ipcRenderer.invoke(channel, { operation: 'occupy-debugger', lease }),
  finish: report => ipcRenderer.invoke(channel, { operation: 'finish', report }),
});
