import { createContext, ReactNode, useContext } from 'react';

import { useSortsSelector } from '@/application/database-yjs';

const GalleryHasSortsContext = createContext(false);

/** Gallery subscribes to sort metadata once, not once for every card. */
export function GallerySortSubscription({ children }: { children: ReactNode }) {
  const hasSorts = useSortsSelector().length > 0;

  return <GalleryHasSortsContext.Provider value={hasSorts}>{children}</GalleryHasSortsContext.Provider>;
}

export function useGalleryHasSorts(): boolean {
  return useContext(GalleryHasSortsContext);
}
