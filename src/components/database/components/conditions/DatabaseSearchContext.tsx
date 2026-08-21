import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';

interface DatabaseSearchContextValue {
  query: string;
  setQuery: (query: string) => void;
}

const defaultValue: DatabaseSearchContextValue = {
  query: '',
  setQuery: () => undefined,
};

const DatabaseSearchContext = createContext<DatabaseSearchContextValue>(defaultValue);

export function DatabaseSearchProvider({ activeViewId, children }: { activeViewId: string; children: ReactNode }) {
  const [state, setState] = useState(() => ({ query: '', viewId: activeViewId }));
  const query = state.viewId === activeViewId ? state.query : '';
  const setQuery = useCallback(
    (nextQuery: string) => setState({ query: nextQuery, viewId: activeViewId }),
    [activeViewId]
  );
  const value = useMemo(() => ({ query, setQuery }), [query, setQuery]);

  useEffect(() => {
    setState((current) => (current.viewId === activeViewId ? current : { query: '', viewId: activeViewId }));
  }, [activeViewId]);

  return <DatabaseSearchContext.Provider value={value}>{children}</DatabaseSearchContext.Provider>;
}

export function useDatabaseSearch() {
  return useContext(DatabaseSearchContext);
}
