import { memo, useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { getDatabaseLayoutFromBlockType } from '@/application/database-block';
import { DatabaseContext, type DatabaseContextState } from '@/application/database-yjs/context';
import { createRowOrdersStore } from '@/application/database-yjs/row-orders-store';
import {
  Types,
  UIVariant,
  YjsDatabaseKey,
  YjsEditorKey,
  type YDatabase,
  type YDatabaseViews,
  type YDoc,
  type YSharedRoot,
} from '@/application/types';
import { ErrorType } from '@/application/utils/error-utils';
import {
  useAppOperations,
  useCurrentWorkspaceIdOptional,
  useEventEmitterOptional,
  useScheduleDeferredCleanup,
} from '@/components/app/app.hooks';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';
import Database from '@/components/database/Database';
import DatabaseViews from '@/components/database/DatabaseViews';
import { useMountedDatabase } from '@/components/database/mounted-database';
import { useDatabaseDeletionStatus } from '@/components/editor/components/blocks/database/hooks/useDatabaseDeletionStatus';
import { useDocumentLoader } from '@/components/editor/components/blocks/database/hooks/useDocumentLoader';
import { useViewMeta } from '@/components/editor/components/blocks/database/hooks/useViewMeta';
import { resolveEmbeddedDatabaseViewId } from '@/components/editor/database-block-lifecycle';

import type { SourceBlock } from './types';

interface Props {
  block: SourceBlock;
  height?: number;
  onSource: (id: string) => void;
}

function Unavailable({ block, onSource, message }: Props & { message: string }) {
  return (
    <div className='ps-database-status' role='status'>
      <p>{message}</p>
      <button onClick={() => onSource(block.id)}>Open source ↗</button>
    </div>
  );
}

const DocumentDatabase = memo(function DocumentDatabase(props: Props) {
  const workspaceId = useCurrentWorkspaceIdOptional();

  if (!workspaceId)
    return <Unavailable {...props} message='Open this presentation in its workspace to show the linked database.' />;

  return (
    <ErrorBoundary fallback={<Unavailable {...props} message='This database view could not be displayed.' />}>
      <ResolveDatabase {...props} workspaceId={workspaceId} />
    </ErrorBoundary>
  );
});

export default DocumentDatabase;

function ResolveDatabase(props: Props & { workspaceId: string }) {
  const { block } = props;
  const reference = block.database!;
  const { loadViewMeta } = useAppOperations();
  const [recoveredId, setRecoveredId] = useState<string | null>();
  const viewId = reference.viewIds[0] || recoveredId;

  useEffect(() => {
    if (reference.viewIds.length) return;
    let canceled = false;

    void resolveEmbeddedDatabaseViewId(
      reference.parentId ?? '',
      reference.databaseId ?? '',
      loadViewMeta,
      getDatabaseLayoutFromBlockType(block.type)
    )
      .catch(() => null)
      .then((id) => {
        if (!canceled) setRecoveredId(id);
      });
    return () => {
      canceled = true;
    };
  }, [reference, block.type, loadViewMeta]);

  if (!viewId)
    return recoveredId === undefined ? (
      <div className='ps-database-status' role='status'>
        Loading database view…
      </div>
    ) : (
      <Unavailable {...props} message='The linked database view is no longer available.' />
    );

  return <LinkedDatabase key={viewId} {...props} viewId={viewId} />;
}

function readDatabase(doc: YDoc | null): YDatabase | undefined {
  return (doc?.getMap(YjsEditorKey.data_section) as YSharedRoot | undefined)?.get(YjsEditorKey.database);
}

/** The database and its views can sync after the document loads; observe both, like the editor's block. */
function useDatabaseView(doc: YDoc | null, viewId: string) {
  const subscribe = useCallback(
    (notify: () => void) => {
      const sharedRoot = doc?.getMap(YjsEditorKey.data_section) as YSharedRoot | undefined;

      if (!sharedRoot) return () => undefined;
      let database: YDatabase | undefined;
      let views: YDatabaseViews | undefined;
      // Follow replacements of the nested maps. Yjs reports removing a handler it never added.
      const watch = () => {
        const nextDatabase = readDatabase(doc);
        const nextViews: YDatabaseViews | undefined = nextDatabase?.get(YjsDatabaseKey.views);

        if (nextDatabase !== database) {
          database?.unobserve(change);
          nextDatabase?.observe(change);
          database = nextDatabase;
        }

        if (nextViews !== views) {
          views?.unobserve(change);
          nextViews?.observe(change);
          views = nextViews;
        }
      };

      const change = () => {
        watch();
        notify();
      };

      watch();
      sharedRoot.observe(change);
      return () => {
        sharedRoot.unobserve(change);
        database?.unobserve(change);
        views?.unobserve(change);
      };
    },
    [doc]
  );

  return useSyncExternalStore(subscribe, () => {
    const database = readDatabase(doc);

    if (!database) return 'missing';
    return database.get(YjsDatabaseKey.views)?.has(viewId) ? 'ready' : 'missing-view';
  });
}

function LinkedDatabase({ block, onSource, workspaceId, viewId, height = 440 }: Props & { workspaceId: string; viewId: string }) {
  const reference = block.database!;
  const operations = useAppOperations();
  const eventEmitter = useEventEmitterOptional();
  const scheduleDeferredCleanup = useScheduleDeferredCleanup();
  const [activeViewId, setActiveViewId] = useState(viewId);
  const permissions = useViewActionPermissions(
    null,
    true,
    activeViewId,
    reference.databaseId ? { collabObjectId: reference.databaseId, collabType: Types.Database } : undefined
  );
  // A database the user cannot read is never fetched, opened from a local copy or synced, so loading
  // waits for read access instead of starting alongside the check as the editor's block does.
  const mounted = useMountedDatabase(workspaceId, activeViewId, reference.databaseId);
  const shared = permissions.canRead ? mounted : undefined;
  const {
    doc: loadedDoc,
    notFound,
    noAccess,
    setNotFound,
  } = useDocumentLoader({
    viewId: permissions.canRead && !shared ? viewId : '',
    databaseId: reference.databaseId,
    loadView: operations.loadView,
    bindViewSync: operations.bindViewSync,
    scheduleDeferredCleanup,
    eventEmitter,
  });
  const { databaseName } = useViewMeta({
    viewId: permissions.canRead && !shared ? viewId : '',
    loadViewMeta: operations.loadViewMeta,
    ignoreMetaErrors: true,
  });
  const doc = shared?.context.databaseDoc ?? loadedDoc;
  const view = useDatabaseView(doc, activeViewId);
  const deletionStatus = useDatabaseDeletionStatus({
    workspaceId,
    viewId,
    databaseId: reference.databaseId,
    hasDatabase: view !== 'missing' && permissions.canRead,
    eventEmitter,
    notFound,
    setNotFound,
  });
  // Database keeps this callback in its context value; a stable one leaves the grid's consumers alone.
  const latestSource = useRef(onSource);

  latestSource.current = onSource;
  const openRowInHostPeek = useCallback(() => latestSource.current(block.id), [block.id]);
  const unavailable = (message: string) => <Unavailable block={block} onSource={onSource} message={message} />;

  if (permissions.permissionError === ErrorType.PageNotFound || permissions.permissionError === ErrorType.Gone)
    return unavailable('This linked database is no longer available.');
  if (permissions.permissionError && permissions.permissionError !== ErrorType.Forbidden)
    return unavailable('This database view could not be loaded. Please try again later.');
  if ((!shared && noAccess) || (permissions.hasLoadedViewActionPermissions && !permissions.canRead))
    return unavailable('You don’t have access to this linked database.');
  if (deletionStatus === 'inTrash') return unavailable('This linked database is in Trash.');
  if ((!shared && notFound) || deletionStatus === 'deleted')
    return unavailable('This linked database is no longer available.');
  if (!permissions.canRead || !doc || (eventEmitter && deletionStatus === null))
    return (
      <div className='ps-database-status' role='status'>
        Loading database view…
      </div>
    );
  if (view !== 'ready') return unavailable('The linked database view is no longer available.');
  if (shared)
    return (
      <SharedDatabase
        context={shared.context}
        height={height}
        name={shared.name}
        visibleViewIds={reference.viewIds.length ? reference.viewIds : [viewId]}
        onChangeView={setActiveViewId}
        onSource={openRowInHostPeek}
      />
    );

  return (
    <Database
      doc={doc}
      workspaceId={workspaceId}
      databasePageId={viewId}
      activeViewId={activeViewId}
      visibleViewIds={reference.viewIds.length ? reference.viewIds : [viewId]}
      onChangeView={setActiveViewId}
      databaseName={databaseName}
      variant={UIVariant.App}
      readOnly
      loadReadOnlyRows
      shareResources={false}
      isDocumentBlock
      embeddedHeight={height}
      canWrite={false}
      canComment={false}
      canShare={false}
      showActions={false}
      paddingStart={0}
      paddingEnd={0}
      loadView={operations.loadView}
      loadViewMeta={operations.loadViewMeta}
      createRow={operations.createRow}
      bindViewSync={operations.bindViewSync}
      scheduleDeferredCleanup={scheduleDeferredCleanup}
      eventEmitter={eventEmitter}
      getViewIdFromDatabaseId={operations.getViewIdFromDatabaseId}
      // Opening a record returns to its source instead of editing inside a slide.
      openRowInHostPeek={openRowInHostPeek}
    />
  );
}

/** A second view of the page's live data: no second row loader, prefetch or sync owner. */
function SharedDatabase({
  context,
  height,
  name,
  visibleViewIds,
  onChangeView,
  onSource,
}: {
  context: DatabaseContextState;
  height: number;
  name: string;
  visibleViewIds: string[];
  onChangeView: (id: string) => void;
  onSource: () => void;
}) {
  const [rowOrdersStore] = useState(createRowOrdersStore);
  const value = useMemo<DatabaseContextState>(
    () => ({
      ...context,
      rowOrdersStore,
      rowOrdersSource: undefined,
      readOnly: true,
      canWrite: false,
      canComment: false,
      canShare: false,
      showActions: false,
      paddingStart: 0,
      paddingEnd: 0,
      isDocumentBlock: true,
      embeddedHeight: height,
      navigateToRow: onSource,
      openRowInHostPeek: onSource,
      onRendered: undefined,
    }),
    [context, height, onSource, rowOrdersStore]
  );

  return (
    <DatabaseContext.Provider value={value}>
      <div className='appflowy-database relative flex min-h-0 w-full flex-1 select-text flex-col overflow-hidden'>
        <DatabaseViews
          fixedHeight={height}
          visibleViewIds={visibleViewIds}
          databasePageId={context.databasePageId}
          viewName={name}
          onChangeView={onChangeView}
          activeViewId={context.activeViewId}
        />
      </div>
    </DatabaseContext.Provider>
  );
}
