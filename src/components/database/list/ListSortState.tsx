import { createContext, type ReactNode, useContext } from 'react';

import { useSortsSelector } from '@/application/database-yjs';

const ListHasSortsContext = createContext(false);

/** Subscribe once for the entire editable List instead of once per row/control. */
export function ListSortSubscription({ children }: { children: ReactNode }) {
  const hasSorts = useSortsSelector().length > 0;

  return <ListHasSortsContext.Provider value={hasSorts}>{children}</ListHasSortsContext.Provider>;
}

/** Static provider used by focused row/action tests and non-subscribing callers. */
export function ListSortState({ children, hasSorts }: { children: ReactNode; hasSorts: boolean }) {
  return <ListHasSortsContext.Provider value={hasSorts}>{children}</ListHasSortsContext.Provider>;
}

export function useListHasSorts() {
  return useContext(ListHasSortsContext);
}
