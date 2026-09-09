import { useEffect, useState } from 'react';

/** Subscribe before reading so a late initial response cannot replace newer IPC state. */
export function useBridgeState<T>(
  read: (() => Promise<T>) | undefined,
  subscribe: ((callback: (value: T) => void) => () => void) | undefined,
  failure: string,
) {
  const [state, setState] = useState<T>();
  const [error, setError] = useState('');
  useEffect(() => {
    setState(undefined);
    setError('');
    if (!read || !subscribe) return;
    let current = true,
      updated = false;
    const off = subscribe((value) => {
      updated = true;
      if (current) {
        setState(value);
        setError('');
      }
    });
    void read()
      .then((value) => {
        if (current && !updated) setState(value);
      })
      .catch(() => {
        if (current && !updated) setError(failure);
      });
    return () => {
      current = false;
      off();
    };
  }, [read, subscribe, failure]);
  return { state, error };
}
