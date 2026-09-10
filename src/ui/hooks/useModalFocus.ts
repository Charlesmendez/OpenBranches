import { useEffect, useRef, type KeyboardEvent, type RefObject } from 'react';

const focusableSelector = [
  'a[href]',
  'button:not([disabled])',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  'summary',
  '[tabindex]:not([tabindex="-1"])',
].join(',');

const focusableElements = (container: HTMLElement) =>
  [...container.querySelectorAll<HTMLElement>(focusableSelector)].filter(
    (element) => element.getClientRects().length > 0,
  );

/** Give every modal one predictable focus boundary and restore the control
 * that opened it. Arrow-driven listbox options may stay outside the Tab order. */
export function useModalFocus<T extends HTMLElement>(
  initialFocus?: RefObject<HTMLElement | null>,
  shouldRestore: () => boolean = () => true,
) {
  const container = useRef<T>(null);
  const restoreCheck = useRef(shouldRestore);
  restoreCheck.current = shouldRestore;

  useEffect(() => {
    const previous =
      document.activeElement instanceof HTMLElement && document.activeElement !== document.body
        ? document.activeElement
        : null;
    const element = container.current;
    const frame = requestAnimationFrame(() => {
      (initialFocus?.current ?? (element ? focusableElements(element)[0] : null))?.focus();
    });
    return () => {
      cancelAnimationFrame(frame);
      if (
        restoreCheck.current() &&
        previous?.isConnected &&
        (document.activeElement === document.body || element?.contains(document.activeElement))
      )
        previous.focus({ preventScroll: true });
    };
  }, [initialFocus]);

  const trapTab = (event: KeyboardEvent) => {
    if (event.key !== 'Tab' || !container.current) return;
    const focusable = focusableElements(container.current);
    if (!focusable.length) {
      event.preventDefault();
      container.current.focus();
      return;
    }
    const index = focusable.indexOf(document.activeElement as HTMLElement);
    if (event.shiftKey && index <= 0) {
      event.preventDefault();
      focusable.at(-1)?.focus();
    } else if (!event.shiftKey && (index < 0 || index === focusable.length - 1)) {
      event.preventDefault();
      focusable[0].focus();
    }
  };

  return { container, trapTab };
}
