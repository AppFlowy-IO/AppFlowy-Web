import { useEffect, useMemo, useRef, useState } from 'react';

import { View } from '@/application/types';
import { isSpaceView } from '@/components/ai-chat/rag-scope';

type RecentRequest = {
  scope: object;
  isCurrent: () => boolean;
  load?: () => Promise<View[] | undefined>;
  cancelled: boolean;
};

/** One active read and one replaceable follow-up, even during permission-event bursts.
 * Old reads may settle, but cannot publish into a reopened dialog or replacement scope.
 */
export function useSearchRecentViews(
  enabled: boolean,
  scope: object,
  isCurrent: () => boolean,
  load?: () => Promise<View[] | undefined>
) {
  const active = useRef(false);
  const pending = useRef<RecentRequest>();
  const displayScope = useMemo(() => ({ scope, enabled }), [scope, enabled]);
  const [snapshot, setSnapshot] = useState<{ scope: object; views: View[] }>();

  useEffect(() => {
    if (!enabled || !isCurrent()) return;
    const request: RecentRequest = { scope: displayScope, isCurrent, load, cancelled: false };

    pending.current = request;
    const drain = async () => {
      if (active.current) return;
      active.current = true;
      try {
        while (pending.current) {
          const next = pending.current;

          pending.current = undefined;
          let views: View[] | undefined;

          try {
            views = navigator.onLine ? await next.load?.() : undefined;
          } catch {
            // Failure never reuses protected names from an older snapshot.
          }

          if (!next.cancelled && next.isCurrent()) {
            setSnapshot({ scope: next.scope, views: views?.filter((view) => !isSpaceView(view)) ?? [] });
          }
        }
      } finally {
        active.current = false;
      }
    };

    void drain();
    return () => {
      request.cancelled = true;
      if (pending.current === request) pending.current = undefined;
    };
  }, [enabled, displayScope, isCurrent, load]);

  return {
    loading: enabled && snapshot?.scope !== displayScope,
    views: snapshot?.scope === displayScope ? snapshot.views : [],
  };
}
