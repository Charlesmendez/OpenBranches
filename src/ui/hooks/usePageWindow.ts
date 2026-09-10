import { useEffect, useState } from 'react';
import { pageWindow } from '../pagination';

/** Keep paging local to one stable result set and return to its first page
 * when higher-priority work changes the order. */
export function usePageWindow<T>(items: T[], pageSize: number, resetKey: string) {
  const [requested, setRequested] = useState(() => ({ key: resetKey, page: 0 }));
  const requestedPage = requested.key === resetKey ? requested.page : 0;
  const current = pageWindow(items, requestedPage, pageSize);

  useEffect(() => {
    if (requested.key !== resetKey || requested.page !== current.page)
      setRequested({ key: resetKey, page: current.page });
  }, [resetKey, requested.key, requested.page, current.page]);

  return {
    ...current,
    setPage: (page: number) => setRequested({ key: resetKey, page }),
  };
}
