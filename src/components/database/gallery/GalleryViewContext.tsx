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
  const [compactMode, setCompact] = useState(() => {
    try {
      return localStorage.getItem(preferenceKey) === 'true';
    } catch {
      return false;
    }
  });

  useSyncListGroupingMetadata(grouping);

  const setCompactMode = useCallback(
    (compact: boolean) => {
      setCompact(compact);
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
