import { useEffect, useRef, type Dispatch, type SetStateAction } from 'react';

/** Close a non-modal popover on outside interaction or Escape and return
 * keyboard focus to its trigger when Escape was used. */
export function useDismissiblePopover(open: boolean, setOpen: Dispatch<SetStateAction<boolean>>) {
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const closeOutside = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeWithEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('pointerdown', closeOutside);
    document.addEventListener('keydown', closeWithEscape);
    return () => {
      document.removeEventListener('pointerdown', closeOutside);
      document.removeEventListener('keydown', closeWithEscape);
    };
  }, [open, setOpen]);

  return { root, trigger };
}
