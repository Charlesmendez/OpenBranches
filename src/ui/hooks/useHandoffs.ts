import { useCallback, useEffect, useState } from 'react';
import type {
  HandoffCommand,
  HandoffPreview,
  HandoffSelection,
  HandoffState,
} from '../../domain/types';

const unavailable: HandoffState = {
  providers: [
    { provider: 'codex', label: 'Codex', installed: false },
    { provider: 'claude-code', label: 'Claude', installed: false },
    { provider: 'cursor', label: 'Cursor', installed: false },
  ],
  handoffs: [],
};

export function useHandoffs(demo: boolean) {
  const [state, setState] = useState<HandoffState>(unavailable);
  const [ready, setReady] = useState(demo || !window.openbranches);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    const api = demo ? undefined : window.openbranches;
    setError('');
    if (!api) {
      setState(unavailable);
      setReady(true);
      return;
    }
    let current = true;
    let eventReceived = false;
    setReady(false);
    const off = api.onHandoffs((next) => {
      if (!current) return;
      eventReceived = true;
      setState(next);
      setReady(true);
    });
    void api
      .getHandoffs()
      .then((next) => {
        if (current && !eventReceived) {
          setState(next);
          setReady(true);
        }
      })
      .catch(() => {
        if (current && !eventReceived) {
          setError('Agent handoffs are unavailable. Restart OpenBranches and try again.');
          setReady(true);
        }
      });
    return () => {
      current = false;
      off();
    };
  }, [demo]);

  const preview = useCallback(
    async (selections: HandoffSelection[]): Promise<HandoffPreview> => {
      setError('');
      if (demo || !window.openbranches)
        throw new Error('Open your live workspace to send branches to an agent.');
      return window.openbranches.previewHandoff(selections);
    },
    [demo],
  );

  const send = useCallback(async (command: HandoffCommand) => {
    if (!window.openbranches) return false;
    setBusy(true);
    setError('');
    try {
      const result = await window.openbranches.sendHandoff(command);
      setState(result.state);
      setError(result.error ?? '');
      return result.ok;
    } catch {
      setError('The handoff could not be sent. Try again.');
      return false;
    } finally {
      setBusy(false);
    }
  }, []);

  return { state, ready, busy, error, preview, send };
}

export type HandoffsController = ReturnType<typeof useHandoffs>;
