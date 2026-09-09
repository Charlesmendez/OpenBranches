import { useEffect, useRef, useState } from 'react';
export function useAction() {
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('');
  const alive = useRef(true),
    running = useRef(false);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  const run = async (action: () => Promise<void>) => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try {
      await action();
    } catch (error) {
      if (alive.current)
        setError(error instanceof Error ? error.message : 'The action could not complete.');
    } finally {
      running.current = false;
      if (alive.current) setBusy(false);
    }
  };
  return { busy, error, run, clear: () => setError('') };
}
