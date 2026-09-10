import { useEffect, useRef, useState } from 'react';
import { pageWindow } from '../pagination';

/** Keep paging local to one stable result set and return to its first page
 * when higher-priority work changes the order. */
export function usePageWindow<T>(
  items: T[],
  pageSize: number,
  resetKey: string,
  remembered?: { page: number; onPage: (page: number) => void },
) {
  const [requested, setRequested] = useState(() => ({
    key: resetKey,
    page: remembered?.page ?? 0,
  }));
  const rememberedPage = remembered?.page;
  const onRememberedPage = useRef(remembered?.onPage);
  onRememberedPage.current = remembered?.onPage;
  const requestedPage = requested.key === resetKey ? requested.page : 0;
  const current = pageWindow(items, requestedPage, pageSize);

  useEffect(() => {
    if (requested.key !== resetKey || requested.page !== current.page)
      setRequested({ key: resetKey, page: current.page });
    if (rememberedPage !== undefined && rememberedPage !== current.page)
      onRememberedPage.current?.(current.page);
  }, [resetKey, requested.key, requested.page, current.page, rememberedPage]);

  return {
    ...current,
    setPage: (page: number) => {
      setRequested({ key: resetKey, page });
      if (rememberedPage !== undefined && rememberedPage !== page) onRememberedPage.current?.(page);
    },
  };
}
