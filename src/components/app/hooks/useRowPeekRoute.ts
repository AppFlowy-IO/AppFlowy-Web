import { useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';

/** Retain navigation, never row data or permission, while a denied route unmounts. */
export function useRowPeekRoute(isRouteView: boolean, activeViewId?: string) {
  const [search, setSearch] = useSearchParams();
  const onRowPeekChange = useCallback((rowId: string | null, viewId?: string) => {
    if (!isRouteView) return;

    setSearch((previous) => {
      const next = new URLSearchParams(previous);

      // A related database needs its own page/permission route. Never restore
      // its row under the current database's identity after a remount.
      if (rowId && (!viewId || viewId === activeViewId)) next.set('r-modal', rowId);
      else next.delete('r-modal');
      return next;
    }, { replace: true });
  }, [activeViewId, isRouteView, setSearch]);

  return { modalRowId: isRouteView ? search.get('r-modal') || undefined : undefined, onRowPeekChange };
}
