import { useEffect, useState } from 'react';

/** Expire activity badges even when no repository snapshot changes. */
export function useClock() {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const update = () => setNow(Date.now());
    const timer = setInterval(update, 30_000);
    window.addEventListener('focus', update);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', update);
    };
  }, []);
  return now;
}
