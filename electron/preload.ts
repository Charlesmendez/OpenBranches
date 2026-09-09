import { contextBridge, ipcRenderer } from 'electron';
import type {
  CodexStatus,
  DesktopApi,
  GitHubStatus,
  GitStatus,
  Snapshot,
} from '../src/domain/types';

const api: DesktopApi = {
  checkGit: () => ipcRenderer.invoke('git:check'),
  installGit: () => ipcRenderer.invoke('git:install'),
  openGitSetupGuide: () => ipcRenderer.invoke('git:guide'),
  onGit: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: GitStatus) => callback(status);
    ipcRenderer.on('git:updated', listener);
    return () => ipcRenderer.removeListener('git:updated', listener);
  },
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
  connectCodex: () => ipcRenderer.invoke('codex:connect'),
  disconnectCodex: () => ipcRenderer.invoke('codex:disconnect'),
  onCodex: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, status: CodexStatus) => callback(status);
    ipcRenderer.on('codex:updated', listener);
    return () => ipcRenderer.removeListener('codex:updated', listener);
  },
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
