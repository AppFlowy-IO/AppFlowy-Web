import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { View } from '@/application/types';
import { isSpaceView } from '@/components/ai-chat/rag-scope';

export type SearchRecentViewsStatus = 'loading' | 'ready' | 'error' | 'offline';

interface RecentRead {
  /** One dialog opening within one access scope. */
  key: object;
  refresh: number;
  retry: number;
}

interface RecentSnapshot extends RecentRead {
  status: Exclude<SearchRecentViewsStatus, 'loading'>;
  views: View[];
}

interface RecentRequest extends RecentRead {
  online: boolean;
  isCurrent: () => boolean;
  load?: () => Promise<View[] | undefined>;
}

const sameRead = (left: RecentRead | undefined, right: RecentRead) =>
  left?.key === right.key && left.refresh === right.refresh && left.retry === right.retry;

/** Spaces are not recent pages, and the endpoint can list a page more than once. */
function recentPages(views: View[]) {
  const seen = new Set<string>();

  return views.filter((view) => {
    if (isSpaceView(view) || seen.has(view.view_id)) return false;
    seen.add(view.view_id);
    return true;
  });
}

/**
 * Recent pages for the search dialog. A loaded list belongs to one dialog opening within one access
 * scope: clearing the query shows it again without another request, while reopening the dialog, a
 * permission hint or a session change loads it again and never shows the previous names meanwhile.
 *
 * Loading, offline, failed and empty are distinct: `load` resolves the list or rejects (a resolved
 * `undefined` also counts as a failure). A socket reconnect (`refreshKey`) revalidates in the
 * background and keeps the current list until the replacement arrives. There is one active read
 * and one replaceable follow-up, even during permission-event bursts; old reads may settle, but
 * cannot publish into a reopened dialog or a replacement scope.
 */
export function useSearchRecentViews({
  open,
  visible,
  scope,
  isCurrent,
  load,
  refreshKey,
  online,
}: {
  open: boolean;
  /** The list is on screen (the query is empty). Reads are deferred while it is hidden. */
  visible: boolean;
  scope: object;
  isCurrent: () => boolean;
  load?: () => Promise<View[] | undefined>;
  refreshKey: number;
  online: boolean;
}) {
  const key = useMemo(() => ({ scope, open }), [scope, open]);
  const latestKey = useRef(key);
  const active = useRef<RecentRequest>();
  const pending = useRef<RecentRequest>();
  const [retry, setRetry] = useState(0);
  const [snapshot, setSnapshot] = useState<RecentSnapshot>();
  const current = snapshot?.key === key ? snapshot : undefined;
  const wanted = useMemo(() => ({ key, refresh: refreshKey, retry }), [key, refreshKey, retry]);
  const stale = !current || !sameRead(current, wanted) || (current.status === 'offline' && online);

  latestKey.current = key;

  useEffect(() => {
    if (!open || !visible || !stale || !isCurrent()) return;
    if (sameRead(pending.current, wanted) || sameRead(active.current, wanted)) return;

    pending.current = { ...wanted, online, isCurrent, load };
    if (active.current) return;

    void (async () => {
      try {
        while (pending.current) {
          const next = pending.current;

          pending.current = undefined;
          // A queued read for a closed dialog, replaced scope or unmounted search is not sent.
          if (next.key !== latestKey.current || !next.isCurrent()) continue;
          active.current = next;
          let result: Pick<RecentSnapshot, 'status' | 'views'>;

          if (!next.online) {
            result = { status: 'offline', views: [] };
          } else {
            try {
              const views = next.load ? await next.load() : [];

              result = views ? { status: 'ready', views: recentPages(views) } : { status: 'error', views: [] };
            } catch {
              result = { status: 'error', views: [] };
            }
          }

          active.current = undefined;
          if (next.key !== latestKey.current || !next.isCurrent()) continue;

          const read = { key: next.key, refresh: next.refresh, retry: next.retry };

          setSnapshot((previous) =>
            // A failed background revalidation keeps names loaded under this same access scope.
            // A new opening or scope never reuses them: its key differs.
            previous?.key === next.key && previous.status === 'ready' && result.status !== 'ready'
              ? { ...previous, ...read }
              : { ...read, ...result }
          );
        }
      } finally {
        active.current = undefined;
      }
    })();
  }, [open, visible, stale, wanted, online, isCurrent, load]);

  const retryLoad = useCallback(() => setRetry((value) => value + 1), []);
  let status: SearchRecentViewsStatus;

  if (current?.status === 'ready') status = 'ready';
  else if (!online) status = 'offline';
  else if (stale) status = 'loading';
  else status = current?.status ?? 'loading';

  return {
    status,
    views: current?.status === 'ready' ? current.views : [],
    /** A ready list is being refreshed in the background. */
    revalidating: status === 'ready' && stale,
    retry: retryLoad,
  };
}
