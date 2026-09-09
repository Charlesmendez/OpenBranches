import { useEffect, useRef } from 'react';
import type { Repository } from '../../domain/types';
import type { ProjectPosition } from '../navigation';

/** View position lives for this app session. Keep demo and real projects apart
 * and discard removed projects; no repository or provider state is written. */
export function useProjectMemory(
  mode: 'live' | 'demo',
  repositories: Repository[],
  loading: boolean,
) {
  const memory = useRef(new Map<string, ProjectPosition>());
  const allowed = useRef({ mode, ids: new Set(repositories.map((repository) => repository.id)) });
  allowed.current = { mode, ids: new Set(repositories.map((repository) => repository.id)) };
  const key = (id: string) => `${mode}:${id}`;
  const read = (id: string): ProjectPosition =>
    memory.current.get(key(id)) ?? { selectedId: null, group: 'active', maps: {} };
  const remember = (id: string, patch: Partial<ProjectPosition>) => {
    if (allowed.current.mode !== mode || !allowed.current.ids.has(id)) return;
    memory.current.set(key(id), { ...read(id), ...patch });
  };
  useEffect(() => {
    if (loading) return;
    const selected = new Set(repositories.map((repository) => key(repository.id)));
    for (const entry of memory.current.keys())
      if (entry.startsWith(`${mode}:`) && !selected.has(entry)) memory.current.delete(entry);
  }, [mode, repositories, loading]);
  return { read, remember };
}
