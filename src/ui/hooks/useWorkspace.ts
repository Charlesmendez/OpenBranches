import { useCallback, useEffect, useRef, useState } from 'react';
import { createDemoSnapshot, refreshDemoPresence } from '../../data/demo';
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
const loadError = 'Your saved workspace could not be loaded. Please try again.';
export function useWorkspace(initialMode: 'live' | 'demo') {
  const [mode, setMode] = useState(initialMode);
  const [demo, setDemo] = useState(demoSnapshot);
  const [live, setLive] = useState<Snapshot>(empty);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(!!window.openbranches);
  const [ready, setReady] = useState(false);
  const [adding, setAdding] = useState(false);
  const generation = useRef(0);
  const reload = useCallback(async () => {
    const api = window.openbranches;
    if (!api) return;
    const request = ++generation.current;
    setLoading(true);
    try {
      const snapshot = await api.getSnapshot();
      if (request === generation.current) {
        setLive(snapshot);
        setReady(true);
        setError(null);
      }
    } catch {
      if (request === generation.current) setError(loadError);
    } finally {
      if (request === generation.current) setLoading(false);
    }
  }, []);
  useEffect(() => {
    const api = window.openbranches;
    if (!api) return;
    let mounted = true;
    void reload();
    const off = api.onSnapshot((snapshot) => {
      if (!mounted) return;
      generation.current++;
      setLive(snapshot);
      setReady(true);
      setLoading(false);
      setError((current) => (current === loadError ? null : current));
    });
    return () => {
      mounted = false;
      generation.current++;
      off();
    };
  }, [reload]);
  useEffect(() => {
    if (mode !== 'demo') return;
    const update = () => setDemo((current) => refreshDemoPresence(current));
    update();
    const timer = window.setInterval(update, 30_000);
    window.addEventListener('focus', update);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener('focus', update);
    };
  }, [mode]);
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
    loading: mode === 'live' && loading,
    ready: mode === 'demo' || ready,
    reload,
    adding,
    add,
    refresh,
    remove,
  };
}
