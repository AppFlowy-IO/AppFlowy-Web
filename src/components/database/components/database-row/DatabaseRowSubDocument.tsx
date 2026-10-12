import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import * as Y from 'yjs';

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
import { hasPendingAtomicRowFirstBody, prepareAtomicRowFirstBody } from '@/application/row-document/atomic-first-body';
import { createFirstBodyDraft } from '@/application/row-document/first-body-actions';
import { FirstBodyOwner } from '@/application/row-document/first-body-owner';
import { deleteCollabDB, openCollabDB } from '@/application/db';
import { getCachedRowSubDoc, trackRowDocEnsure } from '@/application/services/js-services/cache';
import { YjsEditor } from '@/application/slate-yjs';
import { dataStringTOJson } from '@/application/slate-yjs/utils/yjs';
import {
  BlockType,
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
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Log } from '@/utils/log';
import { getErrorMessage } from '@/utils/errors';

import type { EditorContentPadding } from '@/components/editor/EditorContext';

type ContentNode = {
  type?: BlockType | string;
  text?: string;
  children?: unknown[];
  data?: Record<string, unknown>;
};

type IsCurrentRowDocumentRequest = () => boolean;
type RowDocumentAttempt = 'ready' | 'retryable' | 'forbidden';

const ALWAYS_CURRENT_ROW_DOCUMENT_REQUEST = () => true;
const CONFIRMED_ROW_DOCUMENT_LOAD_OPTIONS: LoadRowDocumentOptions = { maxAttempts: 1 };

function hasNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.length > 0;
}

function hasImageContent(data: Record<string, unknown> | undefined) {
  if (!data) return false;

  return (
    hasNonEmptyString(data.url) || hasNonEmptyString(data.retry_local_url) || hasNonEmptyString(data.pending_upload_id)
  );
}

function hasEditorNodeContent(node: unknown): boolean {
  if (typeof node !== 'object' || node === null) return false;

  const contentNode = node as ContentNode;

  if ('text' in contentNode) {
    return hasNonEmptyString(contentNode.text);
  }

  if (contentNode.type === BlockType.ImageBlock) {
    return hasImageContent(contentNode.data);
  }

  if (contentNode.type === YjsEditorKey.text) {
    return contentNode.children?.some(hasEditorNodeContent) ?? false;
  }

  if (contentNode.type && contentNode.type !== BlockType.Page && contentNode.type !== BlockType.Paragraph) {
    return true;
  }

  return contentNode.children?.some(hasEditorNodeContent) ?? false;
}

function hasYjsBlockContent(block: Y.Map<unknown>) {
  const type = block.get(YjsEditorKey.block_type);

  if (!type || type === BlockType.Page || type === BlockType.Paragraph) {
    return false;
  }

  if (type === BlockType.ImageBlock) {
    return hasImageContent(dataStringTOJson(block.get(YjsEditorKey.block_data) as string) as Record<string, unknown>);
  }

  return true;
}

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
  const documentId = meta?.documentId;
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
  const createRowDocument = context?.createRowDocument;
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
  const pendingNonEmptyRef = useRef(false);
  const docReadyRef = useRef(false); // Track if document is loaded to prevent retry timer from resetting it
  // Tracks the documentId this component currently represents, and the one the
  // loaded `doc` actually belongs to. The request-generation guard below only
  // covers work started by the main load effect; these cover every other async
  // caller plus the render path, so a row whose documentId changes never shows
  // or binds the previous row's document.
  const activeDocumentIdRef = useRef<string | undefined>(documentId);
  const loadedDocumentIdRef = useRef<string | null>(null);
  const rowDocEnsuredRef = useRef(false); // Track if row document has been ensured on server to avoid redundant API calls

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
  const [firstBody, setFirstBody] = useState<FirstBodyOwner | null>(null);
  const firstBodyRef = useRef<FirstBodyOwner | null>(null);
  const [firstBodyBusy, setFirstBodyBusy] = useState(false);
  const [firstBodyError, setFirstBodyError] = useState<string | null>(null);
  const writableRef = useRef(!context?.readOnly && context?.canWrite !== false);

  writableRef.current = !context?.readOnly && context?.canWrite !== false;
  const retryLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ensureDocRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRequestGenerationRef = useRef(0);
  const deniedDocumentIdRef = useRef<string | null>(null);
  const mountedRef = useRef(true);
  const [deniedDocumentId, setDeniedDocumentId] = useState<string | null>(null);
  const [failedDocumentId, setFailedDocumentId] = useState<string | null>(null);
  const loadedDocMatchesCurrent = Boolean(doc && documentId && loadedDocumentIdRef.current === documentId);
  const noAccess = Boolean(documentId && deniedDocumentId === documentId);

  const markPermissionDenied = useCallback((deniedId: string) => {
    if (!mountedRef.current || activeDocumentIdRef.current !== deniedId) return;

    deniedDocumentIdRef.current = deniedId;
    loadRequestGenerationRef.current += 1;
    docReadyRef.current = false;
    loadedDocumentIdRef.current = null;
    editorRef.current = null;
    rowDocEnsuredRef.current = false;
    pendingNonEmptyRef.current = false;

    if (pendingMetaUpdateRef.current) {
      clearTimeout(pendingMetaUpdateRef.current);
      pendingMetaUpdateRef.current = null;
    }

    if (retryLoadTimerRef.current) {
      clearTimeout(retryLoadTimerRef.current);
      retryLoadTimerRef.current = null;
    }

    if (ensureDocRetryTimerRef.current) {
      clearTimeout(ensureDocRetryTimerRef.current);
      ensureDocRetryTimerRef.current = null;
    }

    setDoc(null);
    setLoading(false);
    setDeniedDocumentId(deniedId);
    void deleteCollabDB(deniedId, { destroyDoc: true }).catch(() => undefined);
  }, []);

  const document = loadedDocMatchesCurrent ? doc?.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.document) : null;
  // undefined = meta hasn't loaded from Yjs yet (wait)
  // true = meta loaded, document is empty (open locally)
  // false = meta loaded, document has content (load from server)
  const isDocumentEmptyResolved = meta === null || meta === undefined ? undefined : meta.isEmptyDocument ?? true;

  const isDocumentEmpty = useCallback(
    (editor: YjsEditor) => {
      // Only trust meta if it says NOT empty (false) - once content was added, it stays not-empty
      // If meta says empty (true) or undefined, we must check actual content
      if (meta?.isEmptyDocument === false) {
        return false;
      }

      return !editor.children.some(hasEditorNodeContent);
    },
    [meta?.isEmptyDocument]
  );

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

        // Log document state after loading
        const sharedRoot = doc.getMap(YjsEditorKey.data_section) as Y.Map<unknown>;
        const document = sharedRoot?.get(YjsEditorKey.document) as Y.Map<unknown> | undefined;
        const docMeta = document?.get(YjsEditorKey.meta) as Y.Map<unknown> | undefined;
        const textMap = docMeta?.get(YjsEditorKey.text_map) as Y.Map<Y.Text> | undefined;
        const pageId = document?.get(YjsEditorKey.page_id);

        let textCount = 0;
        let sampleText = '';

        if (textMap) {
          for (const text of textMap.values()) {
            const str = text?.toString() || '';

            if (str.length > 0) {
              textCount++;
              if (!sampleText) sampleText = str.slice(0, 30);
            }
          }
        }

        Log.debug('[DatabaseRowSubDocument] handleOpenDocument loaded', {
          rowId,
          documentId,
          pageId,
          hasDocument: !!document,
          textCount,
          sampleText,
        });

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
        rowDocEnsuredRef.current = true; // Document exists on server since we loaded it successfully
        deniedDocumentIdRef.current = null;
        setDeniedDocumentId(null);
        return 'ready';
      } catch (e) {
        if (isPermissionDeniedError(e)) {
          // The server handles eligible legacy recovery during reads, so a final denial must
          // surface as no access instead of starting a separate create/repair request.
          if (isCurrent()) markPermissionDenied(documentId);
          return 'forbidden';
        }

        Log.debug('[DatabaseRowSubDocument] loadRowDocument failed', {
          message: e instanceof Error ? e.message : String(e),
        });
        return 'retryable';
      } finally {
        if (isCurrent()) {
          setLoading(false);
        }
      }
    },
    [loadRowDocument, markPermissionDenied, rowDocumentSource, rowId]
  );
  const openFirstBody = useCallback(async (isCurrent: IsCurrentRowDocumentRequest) => {
    if (!workspaceId || !documentId || !rowDocumentSource || !context?.databaseDoc || !row?.doc || !writableRef.current) {
      throw new Error('The row page cannot be created from this source.');
    }

    const session = await prepareAtomicRowFirstBody({
      workspaceId, documentId, source: rowDocumentSource, databaseDoc: context.databaseDoc,
      rowDoc: row.doc as YDoc, name: '',
      assertWritable: () => {
        if (!writableRef.current) throw new Error('The row page is no longer writable.');
      },
    });

    if (!isCurrent()) { session.dispose(); return; }

    if (session.pending) {
      const current = await session.pending().finally(session.dispose);

      if (!isCurrent()) return;
      setDoc(current);
      loadedDocumentIdRef.current = documentId;
      docReadyRef.current = true;
      rowDocEnsuredRef.current = true;
      setLoading(false);
      return;
    }

    try { session.admit(); } catch (error) { session.dispose(); throw error; }

    const draft = createFirstBodyDraft(documentId);
    const owner = new FirstBodyOwner(draft, {
      assertCurrent: session.owner.assertCurrent,
      assertEditable: session.admit,
      publish: session.publish,
      saveStaging: session.saveStaging,
      onClosed: session.dispose,
      onState: (_phase, error) => {
        if (!mountedRef.current || firstBodyRef.current !== owner) return;
        setFirstBodyBusy(owner.busy);
        setFirstBodyError(error ? getErrorMessage(error) : null);
      },
      onActivated: (current) => {
        if (!mountedRef.current || firstBodyRef.current !== owner || activeDocumentIdRef.current !== documentId) return;
        rowDocEnsuredRef.current = true;
        firstBodyRef.current = null;
        setFirstBody(null);
        setDoc(current as YDoc);
        setFirstBodyBusy(false);
        setFirstBodyError(null);
        owner.detach();
      },
    });

    firstBodyRef.current = owner;
    setFirstBody(owner);
    setDoc(draft);
    loadedDocumentIdRef.current = documentId;
    docReadyRef.current = true;
    setLoading(false);
  }, [context?.databaseDoc, documentId, row, rowDocumentSource, workspaceId]);

  const scheduleEnsureRowDocumentExists = useCallback(() => {
    if (
      !documentId ||
      activeDocumentIdRef.current !== documentId ||
      deniedDocumentIdRef.current === documentId ||
      ensureDocRetryTimerRef.current
    ) {
      return;
    }

    ensureDocRetryTimerRef.current = setTimeout(async () => {
      ensureDocRetryTimerRef.current = null;

      if (activeDocumentIdRef.current !== documentId || deniedDocumentIdRef.current === documentId) {
        return;
      }

      try {
        const exists = checkIfRowDocumentExists ? await checkIfRowDocumentExists(documentId) : false;

        if (activeDocumentIdRef.current !== documentId) {
          return;
        }

        Log.debug('[DatabaseRowSubDocument] ensureRowDocumentExists retry', {
          rowId,
          documentId,
          exists,
        });

        if (!exists && createRowDocument) {
          Log.debug('[DatabaseRowSubDocument] createRowDocument retry', {
            rowId,
            documentId,
          });
          await createRowDocument(documentId, rowDocumentSource);

          if (activeDocumentIdRef.current !== documentId) {
            return;
          }
        }

        if (pendingNonEmptyRef.current) {
          const editor = editorRef.current;

          if (editor && !isDocumentEmpty(editor)) {
            lastIsEmptyRef.current = false;
            pendingNonEmptyRef.current = false;
            Log.debug('[DatabaseRowSubDocument] applying pending non-empty meta', {
              rowId,
              documentId,
            });
            updateRowMeta(RowMetaKey.IsDocumentEmpty, false);
            return;
          }

          pendingNonEmptyRef.current = false;
        }
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          markPermissionDenied(documentId);
          return;
        }

        // Keep retrying until the backend accepts the row document.
      }

      scheduleEnsureRowDocumentExists();
    }, 5000);
  }, [
    checkIfRowDocumentExists,
    createRowDocument,
    documentId,
    isDocumentEmpty,
    markPermissionDenied,
    rowDocumentSource,
    updateRowMeta,
    rowId,
  ]);

  // Drop every trace of the previous document as soon as documentId changes, so
  // the editor never renders or binds the old row's doc while the new one loads.
  useEffect(() => {
    firstBodyRef.current?.detach();
    firstBodyRef.current = null;
    setFirstBody(null);
    setFirstBodyBusy(false);
    setFirstBodyError(null);
    docReadyRef.current = false;
    loadedDocumentIdRef.current = null;
    editorRef.current = null;
    lastIsEmptyRef.current = null;
    pendingNonEmptyRef.current = false;
    rowDocEnsuredRef.current = false;
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

    if (ensureDocRetryTimerRef.current) {
      clearTimeout(ensureDocRetryTimerRef.current);
      ensureDocRetryTimerRef.current = null;
    }

    setDoc(null);
    setDeniedDocumentId(null);
    setFailedDocumentId(null);
    setLoading(Boolean(documentId));
  }, [documentId]);

  useEffect(() => {
    if (!documentId || deniedDocumentIdRef.current === documentId) return;

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

    const scheduleRetry = () => {
      if (retryLoadTimerRef.current || deniedDocumentIdRef.current === documentId) return;
      if (retryCount >= MAX_RETRIES) {
        Log.warn('[DatabaseRowSubDocument] max retries reached; row document was not opened', {
          rowId,
          documentId,
          retryCount,
        });
        setFailedDocumentId(documentId);
        setLoading(false);
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

      try {
        if (workspaceId && writableRef.current && await hasPendingAtomicRowFirstBody(workspaceId, documentId)) {
          if (isCurrentRequest()) await openFirstBody(isCurrentRequest);
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
          await openFirstBody(isCurrentRequest);
          return;
        }

        // Eligible legacy content is repaired by the authorized read path. A
        // missing nonempty body is never converted into a blank create request.
        const attempt = await handleOpenDocument(documentId, CONFIRMED_ROW_DOCUMENT_LOAD_OPTIONS, isCurrentRequest);

        if (attempt === 'retryable' && isCurrentRequest()) scheduleRetry();
      } catch (e) {
        if (!isCurrentRequest()) return;

        if (isPermissionDeniedError(e)) {
          markPermissionDenied(documentId);
          return;
        }

        Log.debug('[DatabaseRowSubDocument] checkIfRowDocumentExists failed; will retry', {
          rowId,
          documentId,
        });
        scheduleRetry();
      }
    };

    void openRowDocument();

    return () => {
      cancelled = true;
      clearRetryTimer();
    };
  }, [
    handleOpenDocument,
    documentId,
    openFirstBody,
    workspaceId,
    checkIfRowDocumentExists,
    isDocumentEmptyResolved,
    hasLocalDocContent,
    markPermissionDenied,
    rowId,
    doc,
  ]);

  useEffect(() => {
    if (firstBody || loading || !doc || !documentId || !loadedDocMatchesCurrent || !bindViewSync) {
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
  }, [firstBody, loading, doc, documentId, loadedDocMatchesCurrent, bindViewSync, rowId]);

  const getMoreAIContext = useCallback(() => {
    return JSON.stringify(properties);
  }, [properties]);

  const shouldSkipIsDocumentEmptyUpdate = useCallback(
    (isEmpty: boolean) => {
      // Skip update if meta already says non-empty and we're reporting empty
      // (meta is authoritative once content was added)
      if (meta?.isEmptyDocument === false && isEmpty) {
        return true;
      }

      return false;
    },
    [meta?.isEmptyDocument]
  );

  const handleEditorConnected = useCallback((editor: YjsEditor) => {
    editorRef.current = editor;
  }, []);

  const ensureRowDocumentExists = useCallback(async () => {
    if (!documentId || activeDocumentIdRef.current !== documentId || deniedDocumentIdRef.current === documentId) {
      return false;
    }

    // Skip if we've already ensured this document exists (memoize to avoid redundant API calls)
    if (rowDocEnsuredRef.current) {
      return true;
    }

    let exists = false;

    if (checkIfRowDocumentExists) {
      try {
        exists = await checkIfRowDocumentExists(documentId);

        if (activeDocumentIdRef.current !== documentId) {
          return false;
        }
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          markPermissionDenied(documentId);
          return false;
        }

        // Ignore and fall through to orphaned view creation attempt.
      }
    }

    if (activeDocumentIdRef.current !== documentId) {
      return false;
    }

    // If document already exists, mark as ensured and return early
    // Don't call createRowDocument if the document is already on the server
    if (exists) {
      rowDocEnsuredRef.current = true;
      return true;
    }

    // Only create orphaned view if document doesn't exist
    if (createRowDocument) {
      try {
        await createRowDocument(documentId, rowDocumentSource);

        if (activeDocumentIdRef.current !== documentId) {
          return false;
        }

        rowDocEnsuredRef.current = true;
        return true;
      } catch (error) {
        if (isPermissionDeniedError(error)) {
          markPermissionDenied(documentId);
        }

        // Creation failed - don't mark as ensured so we can retry
        return false;
      }
    }

    return false;
  }, [checkIfRowDocumentExists, createRowDocument, documentId, markPermissionDenied, rowDocumentSource]);

  useEffect(() => {
    if (firstBody || !doc || !documentId || !loadedDocMatchesCurrent) return;

    // Body of the debounced meta update. Extracted so the unmount cleanup can
    // flush it synchronously instead of cancelling pending work — otherwise a
    // paste-then-close-card sequence loses the just-pasted content because
    // ensureRowDocumentExists() never registers the orphan collab on the
    // server, and the local outbox update has no doc to drain into.
    const flushPendingMetaUpdate = () => {
      if (!pendingMetaUpdateRef.current) return;
      clearTimeout(pendingMetaUpdateRef.current);
      pendingMetaUpdateRef.current = null;

      const editor = editorRef.current;

      if (!editor) {
        return;
      }

      const isEmpty = isDocumentEmpty(editor);

      if (lastIsEmptyRef.current === isEmpty) {
        return;
      }

      if (shouldSkipIsDocumentEmptyUpdate(isEmpty)) {
        return;
      }

      if (isEmpty) {
        lastIsEmptyRef.current = isEmpty;
        pendingNonEmptyRef.current = false;
        Log.debug('[DatabaseRowSubDocument] row document empty -> update meta', {
          rowId,
          documentId,
        });
        updateRowMeta(RowMetaKey.IsDocumentEmpty, isEmpty);
        return;
      }

      void (async () => {
        lastIsEmptyRef.current = isEmpty;
        pendingNonEmptyRef.current = false;
        Log.debug('[DatabaseRowSubDocument] row document edited', {
          rowId,
          documentId,
        });
        Log.debug('[DatabaseRowSubDocument] row document non-empty -> update meta immediately', {
          rowId,
          documentId,
        });
        updateRowMeta(RowMetaKey.IsDocumentEmpty, isEmpty);

        const ensurePromise = ensureRowDocumentExists();

        // Track the in-flight creation so syncAllToServer can await it
        // before batch-syncing. Without this, a page duplicate that runs
        // before the server-side collab is created will silently lose the
        // row sub-document content.
        if (documentId) {
          trackRowDocEnsure(documentId, ensurePromise);
        }

        const ensured = await ensurePromise;

        if (!ensured) {
          scheduleEnsureRowDocumentExists();
        }
      })();
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
      if (origin !== CollabOrigin.Local && origin !== CollabOrigin.LocalManual) {
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
      // Flush — not cancel — so a close-card immediately after paste still
      // marks the row non-empty and registers the orphan collab on the server.
      flushPendingUpdates();
      onRegisterPendingMetaFlush?.(null);
    };
  }, [
    firstBody,
    doc,
    documentId,
    loadedDocMatchesCurrent,
    rowId,
    isDocumentEmpty,
    shouldSkipIsDocumentEmptyUpdate,
    updateRowMeta,
    ensureRowDocumentExists,
    scheduleEnsureRowDocumentExists,
    onRegisterPendingMetaFlush,
    row,
    actorUid,
  ]);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
      firstBodyRef.current?.detach();

      if (ensureDocRetryTimerRef.current) {
        clearTimeout(ensureDocRetryTimerRef.current);
        ensureDocRetryTimerRef.current = null;
      }
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
    return <EditorSkeleton />;
  }

  if (documentId && failedDocumentId === documentId && !loadedDocMatchesCurrent) {
    return (
      <div
        role='alert'
        data-testid='row-document-load-error'
        className='flex min-h-[300px] w-full items-center justify-center px-8 py-10 text-center text-sm text-text-secondary'
      >
        {t('chat.openPagePreviewFailedToast')}
      </div>
    );
  }

  if (!document || !doc || !documentId || !row || !workspaceId || !context) return null;

  const { openPageModal: _openPageModal, ...editorContext } = context;

  return (
    <>
      {firstBodyBusy && <div role='status' data-testid='row-document-creation-pending'>{t('loading')}</div>}
      {firstBodyError && <div role="alert" data-testid="row-document-creation-error">{firstBodyError}
        {firstBody?.canRetry && <button onClick={() => void firstBody.retry()}>{t('atomicCreation.retry')}</button>}
      </div>}
    <Editor
      {...editorContext}
      fullWidth
      contentPadding={contentPadding}
      workspaceId={workspaceId}
      viewId={documentId}
      doc={doc}
      firstBody={firstBody ?? undefined}
      addPage={firstBody ? undefined : editorContext.addPage}
      readOnly={context.readOnly || (firstBody?.blocksInput ?? false)}
      canComment={context.canComment ?? false}
      canWrite={context.canWrite ?? !context.readOnly}
      mentionContext={mentionContext}
      getMoreAIContext={getMoreAIContext}
      onEditorConnected={handleEditorConnected}
    />
    </>
  );
});

export default DatabaseRowSubDocument;
