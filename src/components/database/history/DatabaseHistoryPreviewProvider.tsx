import { useCallback, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { type DatabaseContextState, useDatabaseFields } from '@/application/database-yjs';
import { markDatabaseHistoryRowsImmutable } from '@/application/database-yjs/history-row-store';
import { markDatabaseHistoryDocumentImmutable } from '@/application/database-yjs/immutable';
import { DatabaseViewLayout, type YDatabase, type YDoc, YjsDatabaseKey, YjsEditorKey } from '@/application/types';
import RowPropertyCell from '@/components/database/components/database-row/RowPropertyCell';
import { DatabaseContextProvider } from '@/components/database/DatabaseContext';
import DatabaseViews from '@/components/database/DatabaseViews';
import { CalendarViewType } from '@/components/database/fullcalendar/types';
import { EditorPreviewContextProvider } from '@/components/editor/EditorPreviewContext';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

export interface DatabaseHistoryPreviewProps {
  workspaceId: string;
  databaseId: string;
  databasePageId: string;
  activeViewId?: string;
  root: YDoc;
  /** The complete selected snapshot. The caller owns document disposal. */
  rows: Record<string, YDoc>;
}

function HistoricalRowProperties({ rowId, onClose }: { rowId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const fields = useDatabaseFields();

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className='overflow-y-auto' size='lg'>
        <DialogTitle>{t('databaseHistory.rowProperties', 'Historical row properties')}</DialogTitle>
        <DialogDescription>
          {t('databaseHistory.rowDocumentUnavailable', 'Row-page content is not included in database history.')}
        </DialogDescription>
        <dl className='mt-4 flex flex-col gap-2' data-testid='database-history-row-properties'>
          {Array.from(fields?.entries() ?? []).map(([fieldId, field]) => (
            <div key={fieldId} className='flex min-h-9 items-start gap-3'>
              <dt className='w-40 shrink-0 break-words py-2 text-sm text-text-secondary'>
                {field.get(YjsDatabaseKey.name)}
              </dt>
              <dd className='min-w-0 flex-1'>
                <RowPropertyCell fieldId={fieldId} rowId={rowId} />
              </dd>
            </div>
          ))}
        </dl>
      </DialogContent>
    </Dialog>
  );
}

function HistoricalDatabaseSession({
  workspaceId,
  databasePageId,
  activeViewId: requestedViewId,
  root,
  rows,
}: DatabaseHistoryPreviewProps) {
  const sessionId = useId();
  const { t } = useTranslation();
  const [selectedViewId, setSelectedViewId] = useState(requestedViewId);
  const [selectedRowId, setSelectedRowId] = useState<string>();
  const [calendarViewTypeMap, setCalendarViewTypeMap] = useState(() => new Map<string, CalendarViewType>());
  const views = useMemo(() => {
    const database = root.getMap(YjsEditorKey.data_section).get(YjsEditorKey.database) as YDatabase | undefined;

    return database?.get(YjsDatabaseKey.views);
  }, [root]);
  const viewIds = useMemo(() => {
    return Array.from(views?.keys() ?? []).filter((id) => !views?.get(id)?.get(YjsDatabaseKey.is_inline));
  }, [views]);
  const activeViewId = selectedViewId && viewIds.includes(selectedViewId) ? selectedViewId : viewIds[0] ?? '';
  const layout = Number(views?.get(activeViewId)?.get(YjsDatabaseKey.layout));
  // Grid virtualization and calendar navigation observe the surrounding page
  // scroller. Let their content grow inside the preview's bounded viewport;
  // other layouts need a fixed height for their own internal scroll containers.
  const scrollsWithPreview = layout === DatabaseViewLayout.Grid || layout === DatabaseViewLayout.Calendar;
  const setCalendarViewType = useCallback((viewId: string, viewType: CalendarViewType) => {
    setCalendarViewTypeMap((previous) => new Map(previous).set(viewId, viewType));
  }, []);

  const context = useMemo<DatabaseContextState>(() => {
    // Set the write barrier before any child renders or mount effects run.
    // This is an identity-only WeakSet operation; it does not alter Yjs state.
    markDatabaseHistoryDocumentImmutable(root);
    markDatabaseHistoryRowsImmutable(rows);

    return {
      dataSource: { type: 'history', id: `database-history-${sessionId}` },
      readOnly: true,
      canWrite: false,
      canShare: false,
      canComment: false,
      databaseDoc: root,
      databasePageId,
      activeViewId,
      rowMap: rows,
      workspaceId,
      ensureRow: async (id) => rows[id],
      loadRowFromSeed: async (id) => rows[id],
      peekRowDocFromSeed: (id) => rows[id] ?? null,
      blobPrefetchComplete: true,
      seedsReady: true,
      navigateToRow: (id) => {
        if (rows[id]) setSelectedRowId(id);
      },
      calendarViewTypeMap,
      setCalendarViewType,
      paddingStart: 24,
      paddingEnd: 24,
    };
  }, [activeViewId, calendarViewTypeMap, databasePageId, root, rows, sessionId, setCalendarViewType, workspaceId]);

  if (!activeViewId) {
    return <p className='p-6 text-text-secondary'>{t('databaseHistory.noViews', 'This version has no saved views.')}</p>;
  }

  return (
    <DatabaseContextProvider value={context}>
      <div
        id={context.dataSource?.id}
        className='appflowy-scroll-container h-full min-h-0 w-full overflow-y-auto overscroll-contain'
        data-testid='database-history-preview'
      >
        <div
          className={cn(
            'appflowy-database relative flex w-full select-text flex-col',
            scrollsWithPreview ? 'min-h-full' : 'h-full min-h-0'
          )}
        >
          <div data-history-sticky-overlay className='sticky top-0 z-10 h-0' />
          <DatabaseViews
            activeViewId={activeViewId}
            databasePageId={databasePageId}
            visibleViewIds={viewIds}
            onChangeView={setSelectedViewId}
          />
        </div>
      </div>
      {selectedRowId && <HistoricalRowProperties rowId={selectedRowId} onClose={() => setSelectedRowId(undefined)} />}
    </DatabaseContextProvider>
  );
}

/** Render saved database layouts without mounting any live database loader. */
export function DatabaseHistoryPreview(props: DatabaseHistoryPreviewProps) {
  return (
    <EditorPreviewContextProvider enabled>
      <HistoricalDatabaseSession key={props.root.guid} {...props} />
    </EditorPreviewContextProvider>
  );
}
