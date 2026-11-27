import { useEffect, useState } from 'react';

/** How long a "done" notice stays: long enough to read, short enough not to linger. */
export const FLASH_MS = 4000;

/**
 * A success message that clears itself. Errors are not flashed: they stay
 * until the owner does something about them, so use plain state for those.
 */
export function useFlash(ms = FLASH_MS): [string | null, (next: string | null) => void] {
  const [message, setMessage] = useState<string | null>(null);
  useEffect(() => {
    if (!message) return;
    // Setting state from the timer (not the effect body) is fine for the lint rule.
    const timer = setTimeout(() => setMessage(null), ms);
    return () => clearTimeout(timer);
  }, [message, ms]);
  return [message, setMessage];
}
