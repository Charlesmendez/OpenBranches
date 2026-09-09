import type { TeamDesktopApi } from '../../team/device';
import { useBridgeState } from './useBridgeState';
export function useTeams(api?: TeamDesktopApi) {
  return useBridgeState(
    api?.getTeamConnections,
    api?.onTeamConnections,
    'Could not load team connections. Open Settings again to retry.',
  );
}
export function useTeamSharing(api?: TeamDesktopApi) {
  return useBridgeState(
    api?.getTeamSharing,
    api?.onTeamSharing,
    'Could not load sharing choices. Open Settings again to retry.',
  );
}
