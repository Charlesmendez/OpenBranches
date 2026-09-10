import { useEffect, useRef, type ReactNode } from 'react';
import { Search, X } from 'lucide-react';
export function ListSearch({
  label,
  placeholder,
  value,
  onChange,
}: {
  label: string;
  placeholder: string;
  value: string;
  onChange: (value: string) => void;
}) {
  return (
    <label className="list-search">
      <Search size={16} />
      <input
        aria-label={label}
        placeholder={placeholder}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      />
      {value && (
        <button
          className="icon"
          aria-label={'Clear ' + label.toLowerCase()}
          onClick={() => onChange('')}
        >
          <X size={15} />
        </button>
      )}
    </label>
  );
}
export function Avatar({ name }: { name: string }) {
  return (
    <span className="team-avatar" aria-hidden="true">
      {name.replace(/^@/, '').slice(0, 2).toUpperCase()}
    </span>
  );
}
export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const before = document.activeElement;
    dialog.current?.showModal();
    return () => {
      dialog.current?.close();
      if (before instanceof HTMLElement) before.focus();
    };
  }, []);
  return (
    <dialog
      ref={dialog}
      className="team-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      aria-labelledby="dialog-title"
    >
      <div className="dialog-title">
        <h2 id="dialog-title">{title}</h2>
        <button className="icon" onClick={onClose} aria-label="Close dialog">
          <X size={19} />
        </button>
      </div>
      {children}
    </dialog>
  );
}
export function Notice({ children, error = false }: { children: ReactNode; error?: boolean }) {
  return (
    <p className={'team-notice' + (error ? ' error' : '')} role={error ? 'alert' : 'status'}>
      {children}
    </p>
  );
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="team-empty">
      <h2>{title}</h2>
      <p>{children}</p>
    </div>
  );
}
export const dateLabel = (value?: string | null) =>
  value
    ? new Date(value).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      })
    : 'Not reported';
