import { useEffect, useState } from 'react';
import type { ProviderStatus } from '../../domain/types';

export function useProviders() {
  const [status, setStatus] = useState<ProviderStatus>({
    codex: { installed: false, enabled: false, state: 'not-connected' },
    github: { configured: false, connected: false },
  });
  useEffect(() => {
    const api = window.openbranches;
    if (!api) return;
    let mounted = true;
    void api
      .getProviderStatus()
      .then((value) => {
        if (mounted) setStatus(value);
      })
      .catch(() => {});
    const off = api.onGitHub((github) => setStatus((previous) => ({ ...previous, github })));
    const offCodex = api.onCodex((codex) => setStatus((previous) => ({ ...previous, codex })));
    return () => {
      mounted = false;
      off();
      offCodex();
    };
  }, []);
  return status;
}
