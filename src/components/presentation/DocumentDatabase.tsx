import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';
import { ErrorBoundary } from 'react-error-boundary';

import { getDatabaseLayoutFromBlockType } from '@/application/database-block';
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
import {
  useAppOperations,
  useCurrentWorkspaceIdOptional,
  useEventEmitterOptional,
  useScheduleDeferredCleanup,
} from '@/components/app/app.hooks';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';
import Database from '@/components/database/Database';
import { useDatabaseDeletionStatus } from '@/components/editor/components/blocks/database/hooks/useDatabaseDeletionStatus';
import { useDocumentLoader } from '@/components/editor/components/blocks/database/hooks/useDocumentLoader';
import { useViewMeta } from '@/components/editor/components/blocks/database/hooks/useViewMeta';
import { resolveEmbeddedDatabaseViewId } from '@/components/editor/database-block-lifecycle';

import type { SourceBlock } from './types';

interface Props {
  block: SourceBlock;
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

export default function DocumentDatabase(props: Props) {
  const workspaceId = useCurrentWorkspaceIdOptional();

  if (!workspaceId)
    return <Unavailable {...props} message='Open this presentation in its workspace to show the linked database.' />;

  return (
    <ErrorBoundary fallback={<Unavailable {...props} message='This database view could not be displayed.' />}>
      <ResolveDatabase {...props} workspaceId={workspaceId} />
    </ErrorBoundary>
  );
}

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

function LinkedDatabase({ block, onSource, workspaceId, viewId }: Props & { workspaceId: string; viewId: string }) {
  const reference = block.database!;
  const operations = useAppOperations();
  const eventEmitter = useEventEmitterOptional();
  const scheduleDeferredCleanup = useScheduleDeferredCleanup();
  const [activeViewId, setActiveViewId] = useState(viewId);
  const permissions = useViewActionPermissions(
    null,
    true,
    viewId,
    reference.databaseId ? { collabObjectId: reference.databaseId, collabType: Types.Database } : undefined
  );
  // A database the user cannot read is never fetched, opened from a local copy or synced, so loading
  // waits for read access instead of starting alongside the check as the editor's block does.
  const { doc, notFound, noAccess, setNotFound } = useDocumentLoader({
    viewId: permissions.canRead ? viewId : '',
    databaseId: reference.databaseId,
    loadView: operations.loadView,
    bindViewSync: operations.bindViewSync,
    scheduleDeferredCleanup,
    eventEmitter,
  });
  const { databaseName } = useViewMeta({
    viewId: permissions.canRead ? viewId : '',
    loadViewMeta: operations.loadViewMeta,
    ignoreMetaErrors: true,
  });
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

  if (noAccess || (permissions.hasLoadedViewActionPermissions && !permissions.canRead))
    return unavailable('You don’t have access to this linked database.');
  if (deletionStatus === 'inTrash') return unavailable('This linked database is in Trash.');
  if (notFound || deletionStatus === 'deleted') return unavailable('This linked database is no longer available.');
  if (!permissions.canRead || !doc || (eventEmitter && deletionStatus === null))
    return (
      <div className='ps-database-status' role='status'>
        Loading database view…
      </div>
    );
  if (view !== 'ready') return unavailable('The linked database view is no longer available.');

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
