import { useCallback, useEffect, useRef, useState } from 'react';
import type { GitStatus } from '../../domain/types';

export function useGit() {
  const [status, setStatus] = useState<GitStatus | undefined>(
    window.openbranches ? { state: 'checking', installAvailable: false } : undefined,
  );
  const [checking, setChecking] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [requested, setRequested] = useState(false);
  const [error, setError] = useState('');
  const mounted = useRef(false);
  useEffect(() => {
    if (status?.state === 'ready') {
      setError('');
      setRequested(false);
    }
  }, [status?.state]);
  const recheck = useCallback(async () => {
    const api = window.openbranches;
    if (!api) return;
    setChecking(true);
    try {
      const next = await api.checkGit();
      if (mounted.current) {
        setStatus(next);
        if (next.state === 'ready') setError('');
      }
    } catch {
      if (mounted.current) {
        setStatus({
          state: 'unavailable',
          installAvailable: false,
          message: 'Git could not be checked. Please try again.',
        });
        setError('Git could not be checked. Please try again.');
      }
    } finally {
      if (mounted.current) setChecking(false);
    }
  }, []);
  useEffect(() => {
    mounted.current = true;
    const off = window.openbranches?.onGit(setStatus);
    void recheck();
    window.addEventListener('focus', recheck);
    return () => {
      mounted.current = false;
      off?.();
      window.removeEventListener('focus', recheck);
    };
  }, [recheck]);
  useEffect(() => {
    if (!status || status.state === 'ready') return;
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') void recheck();
    }, 10_000);
    return () => clearInterval(timer);
  }, [status?.state, recheck]);
  const install = async () => {
    if (!window.openbranches || installing) return;
    setInstalling(true);
    setError('');
    try {
      await window.openbranches.installGit();
      if (mounted.current) setRequested(true);
    } catch (error) {
      if (mounted.current)
        setError(
          error instanceof Error
            ? error.message
            : 'Apple’s installer could not be opened. Try the setup guide.',
        );
    } finally {
      if (mounted.current) setInstalling(false);
    }
  };
  const guide = async () => {
    try {
      await window.openbranches?.openGitSetupGuide();
    } catch {
      if (mounted.current) setError('The setup guide could not be opened. Please try again.');
    }
  };
  return { status, checking, installing, requested, error, recheck, install, guide };
}
export type GitSetupController = ReturnType<typeof useGit>;
