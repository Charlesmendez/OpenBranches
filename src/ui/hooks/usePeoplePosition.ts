import { useCallback, useEffect, useState } from 'react';
import type { NavigationMemory, WorkspaceMode } from '../navigationMemory';
import { updatePeoplePosition, type PeoplePosition } from '../peopleNavigation';

export function usePeoplePosition(navigation: NavigationMemory, mode: WorkspaceMode) {
  const [position, setPosition] = useState(() => navigation.people(mode));
  const update = useCallback(
    (patch: Partial<PeoplePosition>) =>
      setPosition((previous) => updatePeoplePosition(previous, patch)),
    [],
  );
  useEffect(() => {
    navigation.rememberPeople(mode, position);
  }, [navigation, mode, position]);
  return { position, update };
}
