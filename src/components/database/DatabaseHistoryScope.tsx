import { createContext, useContext, useMemo, useRef } from 'react';

import { useDatabaseContext } from '@/application/database-yjs';
import { useDatabaseHistoryScope } from '@/components/database/databaseHistoryScopeCoordinator';

import type { CSSProperties, ReactNode } from 'react';

type DatabaseHistoryScopeContextValue = {
  activateHistoryScope: () => void;
  historyScopeId: string;
};

const DatabaseHistoryScopeContext = createContext<DatabaseHistoryScopeContextValue | undefined>(undefined);

export function useDatabaseHistoryScopeContext() {
  return useContext(DatabaseHistoryScopeContext);
}

export function DatabaseHistoryScope({
  children,
  className,
  style,
}: {
  children: ReactNode;
  className?: string;
  style?: CSSProperties;
}) {
  const { readOnly } = useDatabaseContext();
  const scopeRef = useRef<HTMLDivElement | null>(null);
  const { activateHistoryScope, clearHistoryScope, historyScopeId } = useDatabaseHistoryScope({ enabled: !readOnly });
  const contextValue = useMemo(() => ({ activateHistoryScope, historyScopeId }), [activateHistoryScope, historyScopeId]);

  return (
    <DatabaseHistoryScopeContext.Provider value={contextValue}>
      <div
        ref={scopeRef}
        data-database-history-scope={historyScopeId}
        className={className}
        style={style}
        onPointerDownCapture={() => {
          // React events from portals still follow the component tree. Reclaim
          // ownership after the native document listener sees the portaled DOM
          // node as outside this scope.
          activateHistoryScope();
        }}
        onFocusCapture={activateHistoryScope}
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget;

          // A non-focusable pointer target leaves relatedTarget null. The
          // document pointer listener already selected the owning scope (or
          // cleared it for an outside click); preserve that decision on blur.
          if (!nextTarget) return;

          if (!scopeRef.current || !(nextTarget instanceof Node) || !scopeRef.current.contains(nextTarget)) {
            clearHistoryScope();
          }
        }}
      >
        {children}
      </div>
    </DatabaseHistoryScopeContext.Provider>
  );
}
