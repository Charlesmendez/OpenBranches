import type { IpcRenderer } from 'electron';
import type { TeamDesktopApi, TeamConnectionsState } from '../../src/team/device';
export function createTeamBridge(ipc: IpcRenderer): TeamDesktopApi {
  return {
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
