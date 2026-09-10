import { ChevronLeft, ChevronRight } from 'lucide-react';

export function CompactPager({
  page,
  pageSize,
  count,
  label,
  className = '',
  onPage,
}: {
  page: number;
  pageSize: number;
  count: number;
  label: string;
  className?: string;
  onPage: (page: number) => void;
}) {
  const pageCount = Math.max(1, Math.ceil(count / pageSize));
  const start = page * pageSize;
  return (
    <div className={`compact-pager ${className}`.trim()} aria-label={label}>
      <span aria-live="polite">
        {start + 1}–{Math.min(start + pageSize, count)} of {count}
      </span>
      <button
        aria-label={`Previous ${label.toLowerCase()}`}
        aria-disabled={page === 0}
        title="Previous"
        onClick={() => {
          if (page > 0) onPage(page - 1);
        }}
      >
        <ChevronLeft size={13} />
      </button>
      <button
        aria-label={`Next ${label.toLowerCase()}`}
        aria-disabled={page >= pageCount - 1}
        title="Next"
        onClick={() => {
          if (page < pageCount - 1) onPage(page + 1);
        }}
      >
        <ChevronRight size={13} />
      </button>
    </div>
  );
}
