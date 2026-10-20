import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';

import { AtomicCreationPendingError } from '@/application/atomic-creation/journal';
import {
  FieldType,
  getRowTimeString,
  RowMetaKey,
  useDatabase,
  useDatabaseContextOptional,
  useRowData,
  useRowMetaSelector,
} from '@/application/database-yjs';
import { resolveUserAttributionUid, touchRowAttribution } from '@/application/database-yjs/attribution';
import { getCellDataText } from '@/application/database-yjs/cell.parse';
import { useUpdateRowMetaDispatch } from '@/application/database-yjs/dispatch';
import { getMetaIdMap } from '@/application/database-yjs/row_meta';
import { deleteCollabDB, openCollabDB } from '@/application/db';
import { hasPendingAtomicRowFirstBody, prepareAtomicRowFirstBody } from '@/application/row-document/atomic-first-body';
import { hasEditorNodeContent, hasYjsBlockContent } from '@/application/row-document/content';
import { getCachedRowSubDoc } from '@/application/services/js-services/cache';
import { YjsEditor } from '@/application/slate-yjs';
import type { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import {
  CollabOrigin,
  LoadRowDocumentOptions,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseRow,
  YDoc,
  YDocWithMeta,
  RowDocumentSourcePayload,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { isPermissionDeniedError } from '@/application/utils/error-utils';
import { EditorSkeleton } from '@/components/_shared/skeleton/EditorSkeleton';
import { useCurrentWorkspaceIdOptional } from '@/components/app/app.hooks';
import { Editor } from '@/components/editor';
import type { EditorContentPadding } from '@/components/editor/EditorContext';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Log } from '@/utils/log';

type IsCurrentRowDocumentRequest = () => boolean;
type RowDocumentAttempt = 'ready' | 'retryable' | 'forbidden';

const ALWAYS_CURRENT_ROW_DOCUMENT_REQUEST = () => true;
const CONFIRMED_ROW_DOCUMENT_LOAD_OPTIONS: LoadRowDocumentOptions = { maxAttempts: 1 };

/**
 * DatabaseRowSubDocument - Full-featured component for row documents in app mode.
 *
 * This component handles:
 * - Loading documents from server
 * - Creating new documents when needed
 * - WebSocket sync for real-time collaboration
 * - Document update tracking and meta updates
 *
 * For publish mode (read-only), use PublishRowSubDocument instead.
 * The RowSubDocument wrapper handles mode selection automatically.
 */
export type PendingRowDocumentMetaFlush = () => void;
export type RegisterPendingRowDocumentMetaFlush = (flush: PendingRowDocumentMetaFlush | null) => void;

interface DatabaseRowSubDocumentProps {
  rowId: string;
  contentPadding?: EditorContentPadding;
  onRegisterPendingMetaFlush?: RegisterPendingRowDocumentMetaFlush;
}

export const DatabaseRowSubDocument = memo(function DatabaseRowSubDocument({
  rowId,
  contentPadding,
  onRegisterPendingMetaFlush,
}: DatabaseRowSubDocumentProps) {
  const { t } = useTranslation();
  const meta = useRowMetaSelector(rowId);
  // The document identity is deterministic even before lazy Row metadata loads.
  // Keep the loading/error surface available when that read cannot run offline.
  const documentId = meta?.documentId ?? getMetaIdMap(rowId).get(RowMetaKey.DocumentId);
  const database = useDatabase();
  const row = useRowData(rowId) as YDatabaseRow | undefined;
  const currentUser = useCurrentUserOptional();
  const actorUid = resolveUserAttributionUid(currentUser);
  const workspaceId = useCurrentWorkspaceIdOptional();
  const databaseId = database?.get(YjsDatabaseKey.id) as string | undefined;

  // Get context for Editor props and row document operations
  // The context provides mode-specific implementations:
  // - App mode: authenticated APIs, WebSocket sync
  // - Publish mode: published cache, no writes
  const context = useDatabaseContextOptional();
  const mentionContext = useMemo(
    () => ({
      ...context?.mentionContext,
      view_id: documentId,
      database_id: context?.mentionContext?.database_id ?? databaseId,
      database_view_id: context?.mentionContext?.database_view_id ?? context?.activeViewId,
      row_id: rowId,
    }),
    [context?.activeViewId, context?.mentionContext, databaseId, documentId, rowId]
  );

  // Row document operations from context (mode-specific implementations)
  const loadRowDocument = context?.loadRowDocument;
  const checkIfRowDocumentExists = context?.checkIfRowDocumentExists;
  const bindViewSync = context?.bindViewSync;
  const rowDocumentSource = useMemo<RowDocumentSourcePayload | undefined>(() => {
    const databaseId = (database?.get(YjsDatabaseKey.id) as string | undefined) || context?.databaseDoc?.guid;
    const databaseViewId = context?.activeViewId || context?.databasePageId;

    if (!databaseId || !databaseViewId) {
      return undefined;
    }

    return {
      database_id: databaseId,
      database_view_id: databaseViewId,
      row_id: rowId,
    };
  }, [context?.activeViewId, context?.databaseDoc, context?.databasePageId, database, rowId]);
  const updateRowMeta = useUpdateRowMetaDispatch(rowId);
  const editorRef = useRef<YjsEditor | null>(null);
  const lastIsEmptyRef = useRef<boolean | null>(null);
  const pendingMetaUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingAttributionUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const docReadyRef = useRef(false); // Track if document is loaded to prevent retry timer from resetting it
  // Tracks the documentId this component currently represents, and the one the
  // loaded `doc` actually belongs to. The request-generation guard below only
  // covers work started by the main load effect; these cover every other async
  // caller plus the render path, so a row whose documentId changes never shows
  // or binds the previous row's document.
  const activeDocumentIdRef = useRef<string | undefined>(documentId);
  const loadedDocumentIdRef = useRef<string | null>(null);

  activeDocumentIdRef.current = documentId;

  const getCellData = useCallback(
    (cell: YDatabaseCell, field: YDatabaseField) => {
      if (!row) return '';
      const type = Number(field?.get(YjsDatabaseKey.type));

      if (type === FieldType.CreatedTime) {
        return getRowTimeString(field, row.get(YjsDatabaseKey.created_at), currentUser) || '';
      } else if (type === FieldType.LastEditedTime) {
        return getRowTimeString(field, row.get(YjsDatabaseKey.last_modified), currentUser) || '';
      } else if (cell) {
        try {
          return getCellDataText(cell, field, currentUser);
        } catch (e) {
          console.error(e);
          return '';
        }
      }

      return '';
    },
    [row, currentUser]
  );

  const properties = useMemo(() => {
    const obj = {};

    if (!row) return obj;

    const cells = row.get(YjsDatabaseKey.cells);
    const fields = database.get(YjsDatabaseKey.fields);
    const fieldIds = Array.from(fields.keys());

    fieldIds.forEach((fieldId) => {
      const cell = cells.get(fieldId);
      const field = fields.get(fieldId);
      const name = field?.get(YjsDatabaseKey.name);

      if (name) {
        Object.assign(obj, {
          [name]: getCellData(cell, field),
        });
      }
    });

    return obj;
  }, [database, getCellData, row]);

  const [loading, setLoading] = useState(true);
  const [doc, setDoc] = useState<YDoc | null>(null);
  const [retryAttempt, setRetryAttempt] = useState(0);
  const writableRef = useRef(!context?.readOnly && context?.canWrite !== false);

  writableRef.current = !context?.readOnly && context?.canWrite !== false;
  const retryLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRequestGenerationRef = useRef(0);
  const deniedDocumentIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const [deniedDocumentId, setDeniedDocumentId] = useState<string | null>(null);
  const [failedDocumentId, setFailedDocumentId] = useState<string | null>(null);
  const [offlineFailure, setOfflineFailure] = useState(false);
  const loadedDocMatchesCurrent = Boolean(doc && documentId && loadedDocumentIdRef.current === documentId);
  const noAccess = Boolean(documentId && deniedDocumentId === documentId);

  const markPermissionDenied = useCallback((deniedId: string) => {
    if (!mountedRef.current || activeDocumentIdRef.current !== deniedId) return;

    deniedDocumentIdRef.current = deniedId;
    loadRequestGenerationRef.current += 1;
    docReadyRef.current = false;
    loadedDocumentIdRef.current = null;
    editorRef.current = null;

    if (pendingMetaUpdateRef.current) {
      clearTimeout(pendingMetaUpdateRef.current);
      pendingMetaUpdateRef.current = null;
    }

    if (retryLoadTimerRef.current) {
      clearTimeout(retryLoadTimerRef.current);
      retryLoadTimerRef.current = null;
    }

    setDoc(null);
    setLoading(false);
    setDeniedDocumentId(deniedId);
    void deleteCollabDB(deniedId, { destroyDoc: true }).catch(() => undefined);
  }, []);

  const document = loadedDocMatchesCurrent ? doc?.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.document) : null;
  // undefined = meta hasn't loaded from Yjs yet (wait)
  // Content metadata is separate from document existence: empty documents also load from the server.
  const isDocumentEmptyResolved = meta === null || meta === undefined ? undefined : meta.isEmptyDocument ?? true;

  // A remote metadata transition invalidates local deduplication, but must never
  // itself publish content state. Only accepted local document updates do that.
  const latestIsEmptyRef = useRef(meta?.isEmptyDocument);

  if (latestIsEmptyRef.current !== meta?.isEmptyDocument) {
    lastIsEmptyRef.current = null;
    latestIsEmptyRef.current = meta?.isEmptyDocument;
  }

  const hasLocalDocContent = useCallback(
    async (documentId: string): Promise<boolean> => {
      try {
        // Check cached doc first to avoid creating temporary instances
        const localDoc = getCachedRowSubDoc(documentId) ?? (await openCollabDB(documentId));
        const sharedRoot = localDoc.getMap(YjsEditorKey.data_section) as Y.Map<unknown> | undefined;

        if (!sharedRoot || !sharedRoot.has(YjsEditorKey.document)) {
          return false;
        }

        const document = sharedRoot.get(YjsEditorKey.document) as Y.Map<unknown> | undefined;
        const meta = document?.get(YjsEditorKey.meta) as Y.Map<unknown> | undefined;
        const textMap = meta?.get(YjsEditorKey.text_map) as Y.Map<Y.Text> | undefined;

        if (textMap) {
          for (const text of textMap.values()) {
            if (text?.toString().length) {
              return true;
            }
          }
        }

        const blocks = document?.get(YjsEditorKey.blocks) as Y.Map<Y.Map<unknown>> | undefined;

        if (blocks) {
          for (const block of blocks.values()) {
            if (hasYjsBlockContent(block)) {
              return true;
            }
          }
        }
      } catch (e) {
        Log.warn('[DatabaseRowSubDocument] hasLocalDocContent failed', {
          rowId,
          documentId,
          message: e instanceof Error ? e.message : String(e),
        });
        throw e;
      }

      return false;
    },
    [rowId]
  );

  const handleOpenDocument = useCallback(
    async (
      documentId: string,
      options?: LoadRowDocumentOptions,
      isCurrentRequest: IsCurrentRowDocumentRequest = ALWAYS_CURRENT_ROW_DOCUMENT_REQUEST
    ): Promise<RowDocumentAttempt> => {
      const isCurrent = () => isCurrentRequest() && activeDocumentIdRef.current === documentId;

      if (!isCurrent()) return 'retryable';

      Log.debug('[DatabaseRowSubDocument] handleOpenDocument start', { rowId, documentId });
      setLoading(true);
      try {
        docReadyRef.current = false;
        loadedDocumentIdRef.current = null;
        setDoc(null);

        if (!loadRowDocument) {
          Log.debug('[DatabaseRowSubDocument] loadRowDocument not available', { documentId });
          return 'retryable';
        }

        const loadOptions = rowDocumentSource
          ? {
              ...options,
              rowDocumentSource,
            }
          : options;
        const doc = await loadRowDocument(documentId, loadOptions);

        if (!isCurrent()) return 'retryable';

        if (!doc) {
          Log.debug('[DatabaseRowSubDocument] loadRowDocument returned null', { documentId });
          return 'retryable';
        }

        const sharedRoot = doc.getMap(YjsEditorKey.data_section) as Y.Map<unknown>;
        const document = sharedRoot?.get(YjsEditorKey.document) as Y.Map<unknown> | undefined;

        // loadRowDocument can resolve with an empty local doc when the server
        // fetch failed (e.g. the row document doesn't exist yet). Binding to it
        // would permanently show an empty area, so report failure and let the
        // retry/create flow handle it.
        if (!document) {
          Log.warn('[DatabaseRowSubDocument] loaded doc has no document structure; will retry', {
            rowId,
            documentId,
          });
          return 'retryable';
        }

        if (!isCurrent()) return 'retryable';

        setDoc(doc);
        loadedDocumentIdRef.current = documentId;
        docReadyRef.current = true;
        deniedDocumentIdRef.current = null;
        setDeniedDocumentId(null);
        setLoading(false);
        return 'ready';
      } catch (e) {
        if (isPermissionDeniedError(e instanceof AtomicCreationPendingError ? e.cause : e)) {
          // The server handles eligible legacy recovery during reads, so a final denial must
          // surface as no access instead of starting a separate create/repair request.
          if (isCurrent()) markPermissionDenied(documentId);
          return 'forbidden';
        }

        Log.debug('[DatabaseRowSubDocument] loadRowDocument failed', {
          message: e instanceof Error ? e.message : String(e),
        });
        return 'retryable';
      }
    },
    [loadRowDocument, markPermissionDenied, rowDocumentSource, rowId]
  );
  const openCanonicalRowDocument = useCallback(
    async (isCurrent: IsCurrentRowDocumentRequest) => {
      if (
        !workspaceId ||
        !documentId ||
        !rowDocumentSource ||
        !context?.databaseDoc ||
        !row?.doc ||
        !writableRef.current
      ) {
        throw new Error('The row page cannot be created from this source.');
      }

      const session = await prepareAtomicRowFirstBody({
        workspaceId,
        documentId,
        source: rowDocumentSource,
        databaseDoc: context.databaseDoc,
        rowDoc: row.doc as YDoc,
        name: '',
        assertWritable: () => {
          if (!writableRef.current) throw new Error('The row page is no longer writable.');
        },
      });

      try {
        if (!isCurrent()) return;
        // This also recovers a previous authored command. Never mount a detached
        // editor: initialization, receipt hydration and persistence finish first.
        const current = await session.createEmpty();

        if (!isCurrent()) return;
        setDoc(current);
        loadedDocumentIdRef.current = documentId;
        docReadyRef.current = true;
        setLoading(false);
      } finally {
        session.dispose();
      }
    },
    [context?.databaseDoc, documentId, row, rowDocumentSource, workspaceId]
  );

  // Drop every trace of the previous document as soon as documentId changes, so
  // the editor never renders or binds the old row's doc while the new one loads.
  useEffect(() => {
    docReadyRef.current = false;
    loadedDocumentIdRef.current = null;
    editorRef.current = null;
    lastIsEmptyRef.current = null;
    deniedDocumentIdRef.current = null;

    if (pendingMetaUpdateRef.current) {
      clearTimeout(pendingMetaUpdateRef.current);
      pendingMetaUpdateRef.current = null;
    }

    if (pendingAttributionUpdateRef.current) {
      clearTimeout(pendingAttributionUpdateRef.current);
      pendingAttributionUpdateRef.current = null;
    }

    if (retryLoadTimerRef.current) {
      clearTimeout(retryLoadTimerRef.current);
      retryLoadTimerRef.current = null;
    }

    setDoc(null);
    setDeniedDocumentId(null);
    setFailedDocumentId(null);
    setLoading(Boolean(documentId));
  }, [documentId]);

  useEffect(() => {
    if (!documentId || deniedDocumentIdRef.current === documentId || failedDocumentId === documentId) return;

    let cancelled = false;
    const requestGeneration = ++loadRequestGenerationRef.current;
    const isCurrentRequest = () => !cancelled && loadRequestGenerationRef.current === requestGeneration;
    let retryCount = 0;
    const MAX_RETRIES = 3;

    const clearRetryTimer = () => {
      if (retryLoadTimerRef.current) {
        clearTimeout(retryLoadTimerRef.current);
        retryLoadTimerRef.current = null;
      }
    };

    const failOpen = () => {
      setFailedDocumentId(documentId);
      setOfflineFailure(!navigator.onLine);
      setLoading(false);
    };

    const scheduleRetry = () => {
      if (!navigator.onLine) {
        failOpen();
        return;
      }

      if (retryLoadTimerRef.current || deniedDocumentIdRef.current === documentId) return;
      if (retryCount >= MAX_RETRIES) {
        Log.warn('[DatabaseRowSubDocument] max retries reached; row document was not opened', {
          rowId,
          documentId,
          retryCount,
        });
        failOpen();
        return;
      }

      retryLoadTimerRef.current = setTimeout(() => {
        retryLoadTimerRef.current = null;
        if (!isCurrentRequest() || deniedDocumentIdRef.current === documentId) return;

        retryCount++;
        // Re-evaluate server existence on every attempt. An empty-content flag or an exhausted
        // read retry budget must never turn a temporary failure into a repair/create request.
        void openRowDocument();
      }, 2000);
    };

    const openRowDocument = async () => {
      if (!isCurrentRequest() || deniedDocumentIdRef.current === documentId) return;

      // Skip if doc is already loaded - prevents reloading when meta changes
      if (docReadyRef.current && loadedDocumentIdRef.current === documentId && doc) {
        Log.debug('[DatabaseRowSubDocument] skipping effect - doc already loaded', {
          rowId,
          documentId,
        });
        return;
      }

      if (!navigator.onLine) {
        failOpen();
        return;
      }

      // Wait for row meta to load before making any decisions
      if (isDocumentEmptyResolved === undefined) {
        Log.debug('[DatabaseRowSubDocument] waiting for row meta to load', {
          rowId,
          documentId,
        });
        scheduleRetry();
        return;
      }

      // Empty content does not imply a missing server document. Check existence for both
      // states so reopening an empty document can read it without taking the repair write path.
      // Without an existence check, creation still confirms server readiness before binding.
      if (!checkIfRowDocumentExists) {
        const attempt = await handleOpenDocument(documentId, CONFIRMED_ROW_DOCUMENT_LOAD_OPTIONS, isCurrentRequest);

        if (attempt === 'retryable' && isCurrentRequest()) scheduleRetry();
        return;
      }

      let creating = false;

      try {
        if (workspaceId && writableRef.current && (await hasPendingAtomicRowFirstBody(workspaceId, documentId))) {
          creating = true;
          if (isCurrentRequest()) await openCanonicalRowDocument(isCurrentRequest);
          return;
        }

        const exists = await checkIfRowDocumentExists(documentId);

        if (!isCurrentRequest()) return;

        Log.debug('[DatabaseRowSubDocument] checkIfRowDocumentExists', {
          rowId,
          documentId,
          exists,
        });
        if (exists) {
          // Skip loading if doc is already ready
          if (docReadyRef.current && loadedDocumentIdRef.current === documentId) {
            Log.debug('[DatabaseRowSubDocument] doc exists and already loaded, skipping', {
              rowId,
              documentId,
            });
            return;
          }

          // The server handles legacy recovery during reads. Temporary failures stay within
          // the read retry budget instead of sending an explicit create/repair request.
          const loadAttempt = await handleOpenDocument(
            documentId,
            CONFIRMED_ROW_DOCUMENT_LOAD_OPTIONS,
            isCurrentRequest
          );

          if (loadAttempt === 'retryable' && isCurrentRequest()) {
            scheduleRetry();
          }

          return;
        }

        if (isDocumentEmptyResolved) {
          // A legacy local body must not be silently replaced by a blank draft.
          const localHasContent = await hasLocalDocContent(documentId);

          if (!isCurrentRequest()) return;
          if (localHasContent) throw new Error('The existing row-page body must finish recovering before editing.');
          creating = true;
          await openCanonicalRowDocument(isCurrentRequest);
          return;
        }

        // Eligible legacy content is repaired by the authorized read path. A
        // missing nonempty body is never converted into a blank create request.
        const attempt = await handleOpenDocument(documentId, CONFIRMED_ROW_DOCUMENT_LOAD_OPTIONS, isCurrentRequest);

        if (attempt === 'retryable' && isCurrentRequest()) scheduleRetry();
      } catch (e) {
        if (!isCurrentRequest()) return;

        if (isPermissionDeniedError(e instanceof AtomicCreationPendingError ? e.cause : e)) {
          markPermissionDenied(documentId);
          return;
        }

        Log.debug('[DatabaseRowSubDocument] checkIfRowDocumentExists failed; will retry', {
          rowId,
          documentId,
        });
        if (creating) failOpen();
        else scheduleRetry();
      }
    };

    void openRowDocument();

    return () => {
      cancelled = true;
      clearRetryTimer();
    };
  }, [
    retryAttempt,
    failedDocumentId,
    handleOpenDocument,
    documentId,
    openCanonicalRowDocument,
    workspaceId,
    checkIfRowDocumentExists,
    isDocumentEmptyResolved,
    hasLocalDocContent,
    markPermissionDenied,
    rowId,
    doc,
  ]);

  useEffect(() => {
    if (loading || !doc || !documentId || !loadedDocMatchesCurrent || !bindViewSync) {
      Log.debug('[DatabaseRowSubDocument] bindViewSync skipped', {
        rowId,
        documentId,
        loading,
        hasDoc: !!doc,
        loadedDocumentId: loadedDocumentIdRef.current,
        hasBindViewSync: !!bindViewSync,
      });
      return;
    }

    const docWithMeta = doc as YDocWithMeta;
    const docViewId = docWithMeta.view_id ?? docWithMeta.object_id;

    if (docViewId && docViewId !== documentId) {
      Log.debug('[DatabaseRowSubDocument] bindViewSync doc id mismatch', {
        rowId,
        documentId,
        objectId: docWithMeta.object_id,
        viewId: docViewId,
      });
      return;
    }

    const docWithMeta2 = doc as YDocWithMeta;

    Log.debug('[DatabaseRowSubDocument] bindViewSync start', {
      rowId,
      documentId,
      docObjectId: docWithMeta2.object_id,
      docCollabType: docWithMeta2._collabType,
      docSyncBound: docWithMeta2._syncBound,
    });

    try {
      const result = bindViewSync(doc);

      Log.debug('[DatabaseRowSubDocument] bindViewSync result', {
        rowId,
        documentId,
        result: result ? 'success' : 'null',
      });
    } catch (e) {
      Log.error('[DatabaseRowSubDocument] bindViewSync error', e);
    }
  }, [loading, doc, documentId, loadedDocMatchesCurrent, bindViewSync, rowId]);

  const getMoreAIContext = useCallback(() => {
    return JSON.stringify(properties);
  }, [properties]);

  const handleEditorConnected = useCallback((editor: YjsEditor) => {
    editorRef.current = editor;
  }, []);

  useEffect(() => {
    if (!doc || !documentId || !loadedDocMatchesCurrent) return;

    // Read only the active editor after a local Yjs update. Flush on close so
    // paste-then-close and clear-then-close retain their content indicator.
    const flushPendingMetaUpdate = () => {
      if (!pendingMetaUpdateRef.current) return;
      clearTimeout(pendingMetaUpdateRef.current);
      pendingMetaUpdateRef.current = null;

      const editor = editorRef.current;

      if (!editor || activeDocumentIdRef.current !== documentId) return;
      const isEmpty = !editor.children.some(hasEditorNodeContent);

      if ((lastIsEmptyRef.current ?? latestIsEmptyRef.current) === isEmpty) return;
      lastIsEmptyRef.current = isEmpty;
      updateRowMeta(RowMetaKey.IsDocumentEmpty, isEmpty);
    };

    const flushPendingAttributionUpdate = () => {
      if (!pendingAttributionUpdateRef.current) return;
      clearTimeout(pendingAttributionUpdateRef.current);
      pendingAttributionUpdateRef.current = null;

      if (!row || activeDocumentIdRef.current !== documentId) return;

      const update = () => touchRowAttribution(row, actorUid);

      if (row.doc) {
        row.doc.transact(update, CollabOrigin.Local);
      } else {
        update();
      }
    };

    const flushPendingUpdates = () => {
      flushPendingAttributionUpdate();
      flushPendingMetaUpdate();
    };

    const handleDocUpdate = (_update: Uint8Array, origin: unknown) => {
      const isLocalHistory =
        origin instanceof Y.UndoManager && origin === (editorRef.current as YHistoryEditor | null)?.undoManager;

      if (origin !== CollabOrigin.Local && origin !== CollabOrigin.LocalManual && !isLocalHistory) {
        lastIsEmptyRef.current = null;
        return;
      }

      if (pendingMetaUpdateRef.current) {
        clearTimeout(pendingMetaUpdateRef.current);
      }

      pendingMetaUpdateRef.current = setTimeout(flushPendingMetaUpdate, 0);

      if (pendingAttributionUpdateRef.current) {
        clearTimeout(pendingAttributionUpdateRef.current);
      }

      pendingAttributionUpdateRef.current = setTimeout(flushPendingAttributionUpdate, 0);
    };

    doc.on('update', handleDocUpdate);
    onRegisterPendingMetaFlush?.(flushPendingUpdates);

    return () => {
      doc.off('update', handleDocUpdate);
      // Closing an editor must not drop a pending content-state transition.
      flushPendingUpdates();
      onRegisterPendingMetaFlush?.(null);
    };
  }, [doc, documentId, loadedDocMatchesCurrent, rowId, updateRowMeta, onRegisterPendingMetaFlush, row, actorUid]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);

  if (noAccess) {
    return (
      <div
        role='alert'
        data-testid='row-document-no-access'
        className='flex min-h-[300px] w-full flex-col items-center justify-center gap-2 px-8 py-10 text-center'
      >
        <div className='text-base font-medium text-text-primary'>{t('landingPage.forbidden.title')}</div>
        <div className='text-sm text-text-secondary'>{t('document.rowDocument.noAccess')}</div>
      </div>
    );
  }

  if (loading || (doc && documentId && !loadedDocMatchesCurrent)) {
    return (
      <div data-testid='row-document-loading'>
        <EditorSkeleton />
      </div>
    );
  }

  if (documentId && failedDocumentId === documentId && !loadedDocMatchesCurrent) {
    return (
      <div
        role='alert'
        data-testid='row-document-load-error'
        className='flex min-h-[300px] w-full flex-col items-center justify-center gap-3 px-8 py-10 text-center text-sm text-text-secondary'
      >
        {t(offlineFailure ? 'atomicCreation.offline' : 'chat.openPagePreviewFailedToast')}
        <button
          className='rounded-md bg-fill-theme-thick px-4 py-2 text-text-on-fill'
          onClick={() => {
            setFailedDocumentId(null);
            setLoading(true);
            setRetryAttempt((attempt) => attempt + 1);
          }}
        >
          {t('atomicCreation.retry')}
        </button>
      </div>
    );
  }

  if (!document || !doc || !documentId || !row || !workspaceId || !context) return null;

  const { openPageModal: _openPageModal, ...editorContext } = context;

  return (
    <Editor
      {...editorContext}
      fullWidth
      contentPadding={contentPadding}
      workspaceId={workspaceId}
      viewId={documentId}
      doc={doc}
      readOnly={context.readOnly}
      canComment={context.canComment ?? false}
      canWrite={context.canWrite ?? !context.readOnly}
      mentionContext={mentionContext}
      getMoreAIContext={getMoreAIContext}
      onEditorConnected={handleEditorConnected}
    />
  );
});

export default DatabaseRowSubDocument;
