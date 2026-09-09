import type { IpcRenderer } from 'electron';
import type { TeamDesktopApi, TeamConnectionsState } from '../../src/team/device';
import type { TeamSharingState } from '../../src/team/publishing';
export function createTeamBridge(ipc: IpcRenderer): TeamDesktopApi {
  return {
    getTeamSharing: () => ipc.invoke('team:sharing'),
    approveTeamSharing: (id) => ipc.invoke('team:share-approve', id),
    stopTeamSharing: (id) => ipc.invoke('team:share-stop', id),
    forgetTeamSharing: (id) => ipc.invoke('team:share-forget', id),
    refreshTeamSharing: () => ipc.invoke('team:share-refresh'),
    onTeamSharing: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, value: TeamSharingState) =>
        callback(value);
      ipc.on('team:sharing-updated', listener);
      return () => ipc.removeListener('team:sharing-updated', listener);
    },
    getTeamConnections: () => ipc.invoke('team:state'),
    connectTeam: (input) => ipc.invoke('team:connect', input),
    refreshTeamConnections: () => ipc.invoke('team:refresh'),
    disconnectTeam: (id) => ipc.invoke('team:disconnect', id),
    forgetTeam: (id) => ipc.invoke('team:forget', id),
    openTeam: (id) => ipc.invoke('team:open', id),
    previewTeamSharing: (input) => ipc.invoke('team:preview', input),
    onTeamConnections: (callback) => {
      const listener = (_event: Electron.IpcRendererEvent, value: TeamConnectionsState) =>
        callback(value);
      ipc.on('team:updated', listener);
      return () => ipc.removeListener('team:updated', listener);
    },
  };
}
