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
  const pointerOwnershipRef = useRef<boolean | null>(null);
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
          pointerOwnershipRef.current = true;
          activateHistoryScope();
          queueMicrotask(() => {
            pointerOwnershipRef.current = null;
          });
        }}
        onFocusCapture={activateHistoryScope}
        onBlurCapture={(event) => {
          const nextTarget = event.relatedTarget;

          // pointerdown precedes blur. When an in-scope pointer targets a
          // non-focusable card/surface, blur reports body/null; keep the pointer
          // ownership selected above instead of immediately clearing it.
          if (pointerOwnershipRef.current === true) return;

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
