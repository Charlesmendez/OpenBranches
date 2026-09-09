import { contextBridge, ipcRenderer } from 'electron';
import type { DesktopApi, GitHubStatus, Snapshot } from '../src/domain/types';

const api: DesktopApi = {
  getSnapshot: () => ipcRenderer.invoke('snapshot:get'),
  addRepository: () => ipcRenderer.invoke('repository:add'),
  removeRepository: (id) => ipcRenderer.invoke('repository:remove', id),
  refresh: () => ipcRenderer.invoke('snapshot:refresh'),
  revealWorktree: (id, branchId) => ipcRenderer.invoke('worktree:reveal', id, branchId),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  getProviderStatus: () => ipcRenderer.invoke('providers:status'),
  connectGitHub: () => ipcRenderer.invoke('github:connect'),
  pollGitHub: () => ipcRenderer.invoke('github:poll'),
  disconnectGitHub: () => ipcRenderer.invoke('github:disconnect'),
  enablePublicGitHub: () => ipcRenderer.invoke('github:public'),
  onGitHub: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: GitHubStatus) => callback(status);
    ipcRenderer.on('github:updated', listener);
    return () => ipcRenderer.removeListener('github:updated', listener);
  },
  onSnapshot: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: Snapshot) => callback(snapshot);
    ipcRenderer.on('snapshot:updated', listener);
    return () => ipcRenderer.removeListener('snapshot:updated', listener);
  },
};
contextBridge.exposeInMainWorld('openbranches', api);
