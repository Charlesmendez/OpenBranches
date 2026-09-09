import { useEffect, useRef, useSyncExternalStore } from 'react';
import type { Repository } from '../../domain/types';
import type { ProjectPosition } from '../navigation';
import type { NavigationMemory } from '../navigationMemory';

/** Bind saved view preferences to the current, authoritative project list. */
export function useProjectMemory(
  mode: 'live' | 'demo',
  repositories: Repository[],
  loading: boolean,
  memory: NavigationMemory,
) {
  const ids = new Set(repositories.map((repository) => repository.id));
  const allowed = useRef({ mode, ids, loading });
  if (
    allowed.current.mode !== mode ||
    allowed.current.loading !== loading ||
    allowed.current.ids.size !== ids.size ||
    [...ids].some((id) => !allowed.current.ids.has(id))
  )
    allowed.current = { mode, ids, loading };
  const permission = allowed.current;
  const read = (id: string): ProjectPosition => memory.read(mode, id);
  const remember = (id: string, patch: Partial<ProjectPosition>) => {
    if (allowed.current !== permission || permission.loading || !permission.ids.has(id)) return;
    memory.remember(mode, id, patch);
  };
  useEffect(() => {
    if (loading) return;
    memory.prune(mode, new Set(repositories.map((repository) => repository.id)));
  }, [mode, repositories, loading]);
  useEffect(() => {
    const hidden = () => {
      if (document.visibilityState === 'hidden') memory.flush();
    };
    window.addEventListener('pagehide', memory.flush);
    window.addEventListener('beforeunload', memory.flush);
    document.addEventListener('visibilitychange', hidden);
    return () => {
      window.removeEventListener('pagehide', memory.flush);
      window.removeEventListener('beforeunload', memory.flush);
      document.removeEventListener('visibilitychange', hidden);
      memory.flush();
    };
  }, [memory]);
  const notice = useSyncExternalStore(memory.subscribe, memory.getNotice);
  return { read, remember, notice, retrySave: memory.saveNow };
}
