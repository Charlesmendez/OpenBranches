import { useCallback, useEffect, useRef, useState } from 'react';
import { TeamApiError, type TeamClient, type TeamFilter } from '../../src/team/client';
import { loadTeamView, type LoadedTeamView } from '../../src/team/loadView';
import { loadGitHubWork, type LoadedGitHubWork } from '../../src/team/loadGitHubWork';
export { useAction } from '../../src/ui/hooks/useAction';
export function useTeamData(client: TeamClient, workspace: string, filter: TeamFilter) {
  const [data, setData] = useState<LoadedTeamView>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(true),
    [version, setVersion] = useState(0),
    [pages, setPages] = useState(1),
    [connection, setConnection] = useState<'connecting' | 'connected' | 'offline'>('connecting');
  const scope = JSON.stringify(filter),
    previous = useRef(scope);
  const loading = useRef(busy),
    pending = useRef(false);
  const refresh = useCallback(() => {
    if (loading.current) {
      pending.current = true;
      return;
    }
    setVersion((value) => value + 1);
  }, []);
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible' && !loading.current) refresh();
    }, 60000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    const source = new EventSource(client.eventsPath(workspace));
    let revision = '';
    const update = (event: MessageEvent) => {
      try {
        const next = JSON.parse(event.data).revision;
        if (typeof next !== 'string' || !/^\d+$/.test(next)) return;
        setConnection('connected');
        if (next !== revision) {
          revision = next;
          refresh();
        }
      } catch {}
    };
    source.addEventListener('invalidate', update as EventListener);
    source.addEventListener('heartbeat', update as EventListener);
    source.addEventListener('access_revoked', () => {
      source.close();
      setData(undefined);
      setConnection('offline');
      setError('Your workspace access changed. Sign in again to continue.');
      client.accessChanged();
    });
    source.addEventListener('unavailable', () => {
      setConnection('offline');
    });
    source.onerror = () => setConnection('offline');
    return () => source.close();
  }, [client, workspace, refresh]);
  useEffect(() => {
    const abort = new AbortController();
    let wanted = pages;
    if (previous.current !== scope) {
      previous.current = scope;
      setBusy(true);
      setPages(1);
      wanted = 1;
    }
    loading.current = true;
    const timer = setTimeout(
      () => {
        setBusy(true);
        setError('');
        void loadTeamView(client, workspace, filter, wanted, abort.signal)
          .then((value) => {
            if (!abort.signal.aborted) setData(value);
          })
          .catch((error) => {
            if (abort.signal.aborted) return;
            if (error instanceof TeamApiError && (error.status === 401 || error.status === 403))
              setData(undefined);
            setError(error instanceof Error ? error.message : 'Could not load the workspace.');
          })
          .finally(() => {
            if (!abort.signal.aborted) {
              loading.current = false;
              setBusy(false);
              if (pending.current) {
                pending.current = false;
                setVersion((value) => value + 1);
              }
            }
          });
      },
      filter.query ? 220 : 0,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [client, workspace, scope, version, pages]);
  return {
    data,
    error,
    busy,
    version,
    connection,
    refresh,
    loadMore: () => setPages((value) => Math.min(10, value + 1)),
    atLimit: pages >= 10 || data?.limitReached === true,
  };
}

/** GitHub work shares the workspace event revision from useTeamData, avoiding a
 * second event stream while preserving independent filters and pagination. */
export function useGitHubWorkData(
  client: TeamClient,
  workspace: string,
  filter: TeamFilter,
  refreshKey: string,
) {
  const [data, setData] = useState<LoadedGitHubWork>(),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(true),
    [pages, setPages] = useState(1);
  const scope = JSON.stringify(filter),
    previous = useRef(scope);
  useEffect(() => {
    const abort = new AbortController();
    let wanted = pages;
    if (previous.current !== scope) {
      previous.current = scope;
      setPages(1);
      wanted = 1;
    }
    const timer = setTimeout(
      () => {
        setBusy(true);
        setError('');
        void loadGitHubWork(client, workspace, filter, wanted, abort.signal)
          .then((value) => {
            if (!abort.signal.aborted) setData(value);
          })
          .catch((failure) => {
            if (abort.signal.aborted) return;
            if (
              failure instanceof TeamApiError &&
              (failure.status === 401 || failure.status === 403)
            )
              setData(undefined);
            setError(failure instanceof Error ? failure.message : 'Could not load GitHub work.');
          })
          .finally(() => {
            if (!abort.signal.aborted) setBusy(false);
          });
      },
      filter.query ? 220 : 0,
    );
    return () => {
      clearTimeout(timer);
      abort.abort();
    };
  }, [client, workspace, scope, refreshKey, pages]);
  return {
    data,
    error,
    busy,
    loadMore: () => setPages((value) => Math.min(10, value + 1)),
    atLimit: pages >= 10 || data?.limitReached === true,
  };
}
