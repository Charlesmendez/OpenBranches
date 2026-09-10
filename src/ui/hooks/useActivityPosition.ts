import { useCallback, useEffect, useState } from 'react';
import type { NavigationMemory, WorkspaceMode } from '../navigationMemory';
import { updateActivityPosition, type ActivityPosition } from '../activityNavigation';

export function useActivityPosition(navigation: NavigationMemory, mode: WorkspaceMode) {
  const [position, setPosition] = useState(() => navigation.activity(mode));
  const update = useCallback(
    (patch: Partial<ActivityPosition>) =>
      setPosition((previous) => updateActivityPosition(previous, patch)),
    [],
  );
  useEffect(() => {
    navigation.rememberActivity(mode, position);
  }, [navigation, mode, position]);
  return { position, update };
}
