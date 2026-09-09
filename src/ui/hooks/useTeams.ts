import { useEffect, useState } from 'react';
import type { TeamConnectionsState, TeamDesktopApi } from '../../team/device';
export function useTeams(api?: TeamDesktopApi) {
  const [state, setState] = useState<TeamConnectionsState>();
  const [error, setError] = useState('');
  useEffect(() => {
    if (!api) return;
    let current = true,
      updated = false;
    const off = api.onTeamConnections((value) => {
      updated = true;
      if (current) {
        setState(value);
        setError('');
      }
    });
    void api
      .getTeamConnections()
      .then((value) => {
        if (current && !updated) setState(value);
      })
      .catch(() => {
        if (current && !updated)
          setError('Could not load team connections. Open Settings again to retry.');
      });
    return () => {
      current = false;
      off();
    };
  }, [api]);
  return { state, error };
}
