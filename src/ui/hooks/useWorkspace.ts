import { useCallback, useEffect, useState } from 'react';
import { createDemoSnapshot } from '../../data/demo';
import type { Snapshot } from '../../domain/types';

const empty: Snapshot = {
  repositories: [],
  events: [],
  updatedAt: new Date().toISOString(),
  scanning: false,
};
function demoSnapshot() {
  const now = Date.now();
  try {
    const saved = Number(localStorage.getItem('ob-demo-origin-v1'));
    const origin = Number.isSafeInteger(saved) && saved > 0 && saved <= now ? saved : now;
    localStorage.setItem('ob-demo-origin-v1', String(origin));
    return createDemoSnapshot(origin);
  } catch {
    return createDemoSnapshot();
  }
}
const demo = demoSnapshot();
export function useWorkspace() {
  const [mode, setMode] = useState<'live' | 'demo'>(window.openbranches ? 'live' : 'demo');
  const [live, setLive] = useState<Snapshot>(empty);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!window.openbranches);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    const api = window.openbranches;
    if (!api) return;
    let mounted = true;
    api
      .getSnapshot()
      .then((snapshot) => {
        if (mounted) setLive(snapshot);
      })
      .catch((error) => {
        if (mounted) setError(String(error));
      })
      .finally(() => {
        if (mounted) setLoading(false);
      });
    const off = api.onSnapshot((snapshot) => setLive(snapshot));
    return () => {
      mounted = false;
      off();
    };
  }, []);
  const add = useCallback(async () => {
    if (!window.openbranches) {
      setError(
        'Open the desktop app to connect a repository. This browser preview uses demo data.',
      );
      return null;
    }
    setAdding(true);
    try {
      const repository = await window.openbranches.addRepository();
      if (repository) setMode('live');
      return repository;
    } catch (error) {
      setError(error instanceof Error ? error.message : String(error));
      return null;
    } finally {
      setAdding(false);
    }
  }, []);
  const refresh = useCallback(async () => {
    if (mode === 'demo') return;
    try {
      await window.openbranches?.refresh();
    } catch (error) {
      setError(String(error));
    }
  }, [mode]);
  const remove = useCallback(
    async (id: string) => {
      if (mode === 'demo' || !window.openbranches) return false;
      try {
        await window.openbranches.removeRepository(id);
        return true;
      } catch {
        setError('This project could not be removed from your workspace. Please try again.');
        return false;
      }
    },
    [mode],
  );
  return {
    snapshot: mode === 'demo' ? demo : live,
    mode,
    setMode,
    error,
    setError,
    loading,
    adding,
    add,
    refresh,
    remove,
  };
}
