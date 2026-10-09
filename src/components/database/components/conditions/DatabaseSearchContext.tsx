import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

import { DatabaseSearchQueryContext } from '@/application/database-yjs/context';

export interface ClearSearchOptions {
  /** Move the focus to the Search button once the field has collapsed ("Clear search"). */
  focusSearch?: boolean;
}

interface DatabaseSearchContextValue {
  /** The committed query (debounced and trimmed by the header field). */
  query: string;
  setQuery: (query: string) => void;
  /** Clears the query and asks the header field to reset its input and collapse. */
  clearSearch: (options?: ClearSearchOptions) => void;
  /** Changes with each `clearSearch`: the field resets on it without losing a pending keystroke otherwise. */
  clearToken: number;
  /** Changes when a `clearSearch` asks for the focus to return to the Search button. */
  focusSearchToken: number;
}

const defaultValue: DatabaseSearchContextValue = {
  query: '',
  setQuery: () => undefined,
  clearSearch: () => undefined,
  clearToken: 0,
  focusSearchToken: 0,
};

const DatabaseSearchContext = createContext<DatabaseSearchContextValue>(defaultValue);

export interface DatabaseSearchProviderProps {
  /** One query per view instance: switching the view resets it. */
  activeViewId: string;
  /**
   * The query also filters rows (Grid, List, Board: WP09 §1.2). Gallery and
   * Feed keep their card-level search and leave the row search empty.
   */
  applyToRows?: boolean;
  /** A change clears the query (a dashboard widget passes its Edit mode). */
  resetKey?: unknown;
  /**
   * Called when a row search starts or ends (`query !== ''` while it applies
   * to rows), so the host reads every row as it does for a filter.
   */
  onActiveChange?: (active: boolean) => void;
  children: ReactNode;
}

interface SearchState {
  query: string;
  viewId: string;
  clearToken: number;
  focusSearchToken: number;
  resetKey: unknown;
}

/**
 * The session-only search of a database view instance. It is never written
 * to collab, local storage, a saved or private view, or a cache.
 */
export function DatabaseSearchProvider({
  activeViewId,
  applyToRows = false,
  resetKey,
  onActiveChange,
  children,
}: DatabaseSearchProviderProps) {
  const [state, setState] = useState<SearchState>(() => ({
    query: '',
    viewId: activeViewId,
    clearToken: 0,
    focusSearchToken: 0,
    resetKey,
  }));

  // A new reset key (entering or leaving Edit mode) clears the query in the same render.
  if (!Object.is(state.resetKey, resetKey)) {
    setState((current) => ({ ...current, query: '', clearToken: current.clearToken + 1, resetKey }));
  }

  const query = state.viewId === activeViewId ? state.query : '';
  const setQuery = useCallback(
    (nextQuery: string) => setState((current) => ({ ...current, query: nextQuery, viewId: activeViewId })),
    [activeViewId]
  );
  const clearSearch = useCallback(
    (options?: ClearSearchOptions) =>
      setState((current) => ({
        ...current,
        query: '',
        viewId: activeViewId,
        clearToken: current.clearToken + 1,
        focusSearchToken: options?.focusSearch ? current.focusSearchToken + 1 : current.focusSearchToken,
      })),
    [activeViewId]
  );
  const value = useMemo(
    () => ({
      query,
      setQuery,
      clearSearch,
      clearToken: state.clearToken,
      focusSearchToken: state.focusSearchToken,
    }),
    [clearSearch, query, setQuery, state.clearToken, state.focusSearchToken]
  );

  useEffect(() => {
    setState((current) => (current.viewId === activeViewId ? current : { ...current, query: '', viewId: activeViewId }));
  }, [activeViewId]);

  // Gallery and Feed search the cards they show: no row has to be read for it.
  const active = applyToRows && query !== '';
  const onActiveChangeRef = useRef(onActiveChange);
  const reportedActiveRef = useRef(false);

  useEffect(() => {
    onActiveChangeRef.current = onActiveChange;
  }, [onActiveChange]);

  useEffect(() => {
    if (reportedActiveRef.current === active) return;
    reportedActiveRef.current = active;
    onActiveChangeRef.current?.(active);
  }, [active]);

  // A provider that goes away with an active search leaves nothing behind.
  useEffect(
    () => () => {
      if (reportedActiveRef.current) onActiveChangeRef.current?.(false);
    },
    []
  );

  return (
    <DatabaseSearchContext.Provider value={value}>
      <DatabaseSearchQueryContext.Provider value={applyToRows ? query : ''}>
        {children}
      </DatabaseSearchQueryContext.Provider>
    </DatabaseSearchContext.Provider>
  );
}

export function useDatabaseSearch() {
  return useContext(DatabaseSearchContext);
}
