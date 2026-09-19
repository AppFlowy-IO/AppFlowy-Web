import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { DatabaseContext, DatabaseContextState, useDatabaseContext } from '@/application/database-yjs';
import { useAddDatabaseView } from '@/application/database-yjs/dispatch';
import { DatabaseViewLayout, YDoc } from '@/application/types';

export interface CreateWidgetViewRequest {
  databaseId: string;
  /** A regular view of the target database (opens its doc, resolves its container). */
  primaryViewId: string;
  isHost: boolean;
  layout: DatabaseViewLayout;
  name?: string;
}

interface PendingForeignCreation {
  id: number;
  doc: YDoc;
  primaryViewId: string;
  layout: DatabaseViewLayout;
  name?: string;
  resolve: (viewId: string) => void;
  reject: (error: unknown) => void;
}

function ForeignViewCreator({
  request,
  onSettled,
}: {
  request: PendingForeignCreation;
  onSettled: (id: number) => void;
}) {
  const addView = useAddDatabaseView();
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;

    addView(request.layout, request.name)
      .then(request.resolve, request.reject)
      .finally(() => onSettled(request.id));
  }, [addView, onSettled, request]);

  return null;
}

/**
 * Create a database view for a new widget.
 *
 * The host database goes through `useAddDatabaseView` directly. For another
 * database the same hook runs inside a short-lived database context bound to
 * that database's doc (opened with the host's `loadView`), so container
 * resolution, validation and the local Yjs update are identical to adding a
 * tab in that database. Render `bridge` somewhere that outlives the picker.
 */
export function useCreateWidgetView(): {
  createView: (request: CreateWidgetViewRequest) => Promise<string>;
  canCreateInOtherDatabases: boolean;
  bridge: ReactNode;
} {
  const hostContext = useDatabaseContext();
  const addHostView = useAddDatabaseView();
  const [pending, setPending] = useState<PendingForeignCreation[]>([]);
  const pendingRef = useRef(pending);
  const sequenceRef = useRef(0);
  const { loadView, createDatabaseView } = hostContext;

  pendingRef.current = pending;

  useEffect(
    () => () => {
      pendingRef.current.forEach((request) => request.reject(new Error('The dashboard was closed')));
    },
    []
  );

  const createView = useCallback(
    async ({ databaseId, primaryViewId, isHost, layout, name }: CreateWidgetViewRequest) => {
      if (isHost) return addHostView(layout, name);

      if (!loadView || !createDatabaseView) {
        throw new Error('Creating views in other databases is not available');
      }

      const doc = await loadView(primaryViewId, false, false, { databaseId });

      return new Promise<string>((resolve, reject) => {
        sequenceRef.current += 1;
        setPending((current) => [
          ...current,
          { id: sequenceRef.current, doc, primaryViewId, layout, name, resolve, reject },
        ]);
      });
    },
    [addHostView, createDatabaseView, loadView]
  );

  const handleSettled = useCallback((id: number) => {
    setPending((current) => current.filter((request) => request.id !== id));
  }, []);

  const bridge = useMemo(
    () =>
      pending.map((request) => {
        const value: DatabaseContextState = {
          ...hostContext,
          databaseDoc: request.doc,
          databasePageId: request.primaryViewId,
          activeViewId: request.primaryViewId,
          rowMap: null,
          // The new view is a regular tab of the other database.
          isDocumentBlock: false,
          isDashboardWidget: false,
        };

        return (
          <DatabaseContext.Provider key={request.id} value={value}>
            <ForeignViewCreator request={request} onSettled={handleSettled} />
          </DatabaseContext.Provider>
        );
      }),
    [handleSettled, hostContext, pending]
  );

  return {
    createView,
    canCreateInOtherDatabases: Boolean(loadView && createDatabaseView),
    bridge,
  };
}
