import { useCallback, useEffect, useRef, useState } from 'react';
import { toast } from 'sonner';

import { getErrorMessage } from '@/utils/errors';
import { Log } from '@/utils/log';

/** One awaited gesture owns its progress and error; concurrent gestures cannot duplicate it. */
export function useRowCreationAction() {
  const active = useRef(false);
  const mounted = useRef(true);
  const [pending, setPending] = useState(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(async <T,>(action: () => Promise<T>): Promise<{ ok: true; value: T } | { ok: false }> => {
    if (active.current) return { ok: false };
    active.current = true;
    setPending(true);
    try {
      const value = await action();

      return mounted.current ? { ok: true, value } : { ok: false };
    } catch (error) {
      Log.error('[Row creation] action failed', error);
      if (mounted.current) toast.error(getErrorMessage(error));
      return { ok: false };
    } finally {
      active.current = false;
      if (mounted.current) setPending(false);
    }
  }, []);

  return { pending, run };
}

export function RowCreationSpinner({ className = 'h-4 w-4' }: { className?: string }) {
  return (
    <span
      aria-hidden='true'
      className={`${className} inline-block shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none`}
    />
  );
}
