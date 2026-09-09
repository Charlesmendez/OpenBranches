import '../../electron/preload';
import { contextBridge, ipcRenderer } from 'electron';

// This separate fixture preload is never bundled into the production app.
contextBridge.exposeInMainWorld('openbranchesFixture', {
  snapshot: () => ipcRenderer.invoke('fixture:snapshot'),
  change: () => ipcRenderer.invoke('fixture:change'),
  restart: () => ipcRenderer.invoke('fixture:restart'),
});
