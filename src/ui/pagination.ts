export interface PageWindow<T> {
  page: number;
  pageCount: number;
  start: number;
  items: T[];
}

/** Clamp a requested page against a changing collection and return one slice. */
export function pageWindow<T>(
  items: T[],
  requestedPage: number,
  requestedSize: number,
): PageWindow<T> {
  const pageSize = Math.max(1, Math.floor(requestedSize) || 1);
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safeRequest = Number.isFinite(requestedPage) ? Math.max(0, Math.floor(requestedPage)) : 0;
  const page = Math.min(safeRequest, pageCount - 1);
  const start = page * pageSize;
  return { page, pageCount, start, items: items.slice(start, start + pageSize) };
}
