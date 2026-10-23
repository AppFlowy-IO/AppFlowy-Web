import { createContext, type ReactNode, useCallback, useContext, useMemo, useRef, useState } from 'react';

import { useDatabaseContext, useDatabaseGroupingSelector } from '@/application/database-yjs';
import type { DatabaseGrouping } from '@/application/database-yjs';
import { DatabaseViewLayout } from '@/application/types';
import { useSyncListGroupingMetadata } from '@/components/database/list/ListGroupingContext';

interface GalleryViewState {
  grouping: DatabaseGrouping;
  compactMode: boolean;
  setCompactMode: (compact: boolean) => void;
}

const GalleryViewContext = createContext<GalleryViewState | undefined>(undefined);

type RepositionSession = { id: symbol; save: () => void };
const GalleryRepositionContext = createContext<{
  begin: (session: RepositionSession) => void;
  end: (id: symbol) => void;
} | null>(null);

export const useGalleryReposition = () => useContext(GalleryRepositionContext);

function readCompactPreference(key: string): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

export function useGalleryView() {
  const value = useContext(GalleryViewContext);

  if (!value) throw new Error('useGalleryView must be used within GalleryViewProvider');

  return value;
}

/** Share grouping and the local presentation preference between Gallery and its menu. */
export function GalleryViewProvider({ children }: { children: ReactNode }) {
  const { activeViewId, workspaceId } = useDatabaseContext();
  const grouping = useDatabaseGroupingSelector(DatabaseViewLayout.Gallery);
  const repositionSession = useRef<RepositionSession | null>(null);
  // Keep drag previews local to each card; only entering another card saves
  // the previous session, matching the desktop Gallery controller.
  const reposition = useMemo(
    () => ({
      begin: (session: RepositionSession) => {
        if (repositionSession.current?.id !== session.id) repositionSession.current?.save();
        repositionSession.current = session;
      },
      end: (id: symbol) => {
        if (repositionSession.current?.id === id) repositionSession.current = null;
      },
    }),
    []
  );
  const preferenceKey = `appflowy:gallery-compact:v1:${workspaceId}:${activeViewId}`;
  // Read per key so switching to another Gallery view shows that view's own
  // preference without the provider having to be remounted.
  const storedCompactMode = useMemo(() => readCompactPreference(preferenceKey), [preferenceKey]);
  const [compactOverride, setCompactOverride] = useState<{ key: string; compact: boolean } | null>(null);
  const compactMode = compactOverride?.key === preferenceKey ? compactOverride.compact : storedCompactMode;

  useSyncListGroupingMetadata(grouping);

  const setCompactMode = useCallback(
    (compact: boolean) => {
      setCompactOverride({ key: preferenceKey, compact });
      try {
        localStorage.setItem(preferenceKey, String(compact));
      } catch {
        // The preference still works for this session when browser storage is unavailable.
      }
    },
    [preferenceKey]
  );
  const value = useMemo(() => ({ grouping, compactMode, setCompactMode }), [grouping, compactMode, setCompactMode]);

  return (
    <GalleryViewContext.Provider value={value}>
      <GalleryRepositionContext.Provider value={reposition}>{children}</GalleryRepositionContext.Provider>
    </GalleryViewContext.Provider>
  );
}
