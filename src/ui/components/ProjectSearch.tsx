import { Search, X } from 'lucide-react';
import { useRef } from 'react';

export function ProjectSearch({
  query,
  onChange,
  label = 'Search projects',
}: {
  query: string;
  onChange: (query: string) => void;
  label?: string;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="project-search">
      <Search size={14} aria-hidden="true" />
      <input
        ref={input}
        aria-label={label}
        placeholder="Search projects…"
        value={query}
        maxLength={2048}
        spellCheck={false}
        autoCorrect="off"
        autoCapitalize="none"
        onChange={(event) => onChange(event.target.value)}
      />
      {query && (
        <button
          aria-label={`Clear ${label.toLowerCase()}`}
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}
