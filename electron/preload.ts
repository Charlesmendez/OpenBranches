import { contextBridge, ipcRenderer } from 'electron';
import { createTeamBridge } from './team/preload';
import type {
  CodexStatus,
  DesktopApi,
  GitHubStatus,
  GitStatus,
  Snapshot,
  ReviewState,
  ProjectDiscoveryState,
  AgentHistoryStatus,
  AgentLiveStatus,
  HandoffState,
} from '../src/domain/types';

const api: DesktopApi = {
  teams: createTeamBridge(ipcRenderer),
  setAgentHistoryEnabled: (tool, enabled) => ipcRenderer.invoke('agents:enable', tool, enabled),
  onAgentHistory: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, statuses: AgentHistoryStatus[]) =>
      callback(statuses);
    ipcRenderer.on('agents:updated', listener);
    return () => ipcRenderer.removeListener('agents:updated', listener);
  },
  setAgentLiveEnabled: (tool, enabled) => ipcRenderer.invoke('agents:live-enable', tool, enabled),
  onAgentLive: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, statuses: AgentLiveStatus[]) =>
      callback(statuses);
    ipcRenderer.on('agents:live-updated', listener);
    return () => ipcRenderer.removeListener('agents:live-updated', listener);
  },
  getDiscoveredProjects: () => ipcRenderer.invoke('discovery:get'),
  followDiscoveredProjects: (enabled) => ipcRenderer.invoke('discovery:follow', enabled),
  refreshDiscoveredProjects: () => ipcRenderer.invoke('discovery:refresh'),
  restoreDiscoveredProjects: () => ipcRenderer.invoke('discovery:restore'),
  onDiscoveredProjects: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ProjectDiscoveryState) =>
      callback(state);
    ipcRenderer.on('discovery:updated', listener);
    return () => ipcRenderer.removeListener('discovery:updated', listener);
  },
  getReviews: () => ipcRenderer.invoke('reviews:get'),
  decideReview: (command) => ipcRenderer.invoke('reviews:decide', command),
  resetReviews: (repositoryId) => ipcRenderer.invoke('reviews:reset', repositoryId),
  onReviews: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: ReviewState) => callback(state);
    ipcRenderer.on('reviews:updated', listener);
    return () => ipcRenderer.removeListener('reviews:updated', listener);
  },
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
  revealWorktree: (id, branchId, worktreePath) =>
    ipcRenderer.invoke('worktree:reveal', id, branchId, worktreePath),
  openExternal: (url) => ipcRenderer.invoke('external:open', url),
  getProviderStatus: () => ipcRenderer.invoke('providers:status'),
  connectGitHub: () => ipcRenderer.invoke('github:connect'),
  pollGitHub: () => ipcRenderer.invoke('github:poll'),
  disconnectGitHub: () => ipcRenderer.invoke('github:disconnect'),
  enablePublicGitHub: () => ipcRenderer.invoke('github:public'),
  connectCodex: () => ipcRenderer.invoke('codex:connect'),
  disconnectCodex: () => ipcRenderer.invoke('codex:disconnect'),
  openCodexTask: (command) => ipcRenderer.invoke('codex:open-task', command),
  getHandoffs: () => ipcRenderer.invoke('handoffs:get'),
  previewHandoff: (selections) => ipcRenderer.invoke('handoffs:preview', selections),
  sendHandoff: (command) => ipcRenderer.invoke('handoffs:send', command),
  onHandoffs: (callback) => {
    const listener = (_event: Electron.IpcRendererEvent, state: HandoffState) => callback(state);
    ipcRenderer.on('handoffs:updated', listener);
    return () => ipcRenderer.removeListener('handoffs:updated', listener);
  },
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
