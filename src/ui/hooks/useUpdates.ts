import { useCallback, useEffect, useRef, useState } from 'react';
import type { UpdateStatus } from '../../domain/types';

export function useUpdates() {
  const [status, setStatus] = useState<UpdateStatus>();
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    const api = window.openbranches;
    if (!api)
      return () => {
        mounted.current = false;
      };
    let received = false;
    const off = api.onUpdate((next) => {
      received = true;
      if (mounted.current) setStatus(next);
    });
    void api
      .getUpdateStatus()
      .then((next) => {
        if (mounted.current && !received) setStatus(next);
      })
      .catch(() => {
        if (mounted.current && !received)
          setStatus({
            currentVersion: '',
            state: 'error',
            error: 'OpenBranches could not read the update status.',
          });
      });
    return () => {
      mounted.current = false;
      off();
    };
  }, []);

  const check = useCallback(async () => {
    const api = window.openbranches;
    if (!api) return;
    try {
      const next = await api.checkForUpdates();
      if (mounted.current) setStatus(next);
    } catch (error) {
      if (mounted.current)
        setStatus((current) => ({
          currentVersion: current?.currentVersion ?? '',
          state: 'error',
          error: error instanceof Error ? error.message : 'The update check failed.',
        }));
    }
  }, []);

  const install = useCallback(async () => {
    const api = window.openbranches;
    if (!api) return;
    try {
      await api.installUpdate();
    } catch (error) {
      if (mounted.current)
        setStatus((current) => ({
          currentVersion: current?.currentVersion ?? '',
          state: 'error',
          error: error instanceof Error ? error.message : 'The update could not be installed.',
        }));
    }
  }, []);

  return { status, check, install };
}

export type UpdateController = ReturnType<typeof useUpdates>;
