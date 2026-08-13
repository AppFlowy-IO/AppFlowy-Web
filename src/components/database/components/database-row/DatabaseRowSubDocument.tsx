import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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
import { getCellDataText } from '@/application/database-yjs/cell.parse';
import { useUpdateRowMetaDispatch } from '@/application/database-yjs/dispatch';
import { openCollabDB } from '@/application/db';
import { getCachedRowSubDoc, getOrCreateRowSubDoc, trackRowDocEnsure } from '@/application/services/js-services/cache';
import { YjsEditor } from '@/application/slate-yjs';
import { dataStringTOJson } from '@/application/slate-yjs/utils/yjs';
import {
  BlockType,
  CollabOrigin,
  LoadRowDocumentOptions,
  Types,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseRow,
  YDoc,
  YDocWithMeta,
  RowDocumentSourcePayload,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { EditorSkeleton } from '@/components/_shared/skeleton/EditorSkeleton';
import { useCurrentWorkspaceIdOptional } from '@/components/app/app.hooks';
import { Editor } from '@/components/editor';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Log } from '@/utils/log';

import type { EditorContentPadding } from '@/components/editor/EditorContext';

type ContentNode = {
  type?: BlockType | string;
  text?: string;
  children?: unknown[];
  data?: Record<string, unknown>;
};

type IsCurrentRowDocumentRequest = () => boolean;

const ALWAYS_CURRENT_ROW_DOCUMENT_REQUEST = () => true;
const CONFIRMED_ROW_DOCUMENT_LOAD_OPTIONS: LoadRowDocumentOptions = { maxAttempts: 1 };

function hasNonEmptyString(value: unknown) {
  return typeof value === 'string' && value.length > 0;
}

function hasImageContent(data: Record<string, unknown> | undefined) {
  if (!data) return false;

  return (
    hasNonEmptyString(data.url) ||
    hasNonEmptyString(data.retry_local_url) ||
    hasNonEmptyString(data.pending_upload_id)
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
  const meta = useRowMetaSelector(rowId);
  const documentId = meta?.documentId;
  const database = useDatabase();
  const row = useRowData(rowId) as YDatabaseRow | undefined;
  const currentUser = useCurrentUserOptional();
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
  const retryLoadTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const ensureDocRetryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const loadRequestGenerationRef = useRef(0);
  const loadedDocMatchesCurrent = Boolean(doc && documentId && loadedDocumentIdRef.current === documentId);

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
    ): Promise<boolean> => {
      const isCurrent = () => isCurrentRequest() && activeDocumentIdRef.current === documentId;

      if (!isCurrent()) return false;

      Log.debug('[DatabaseRowSubDocument] handleOpenDocument start', { rowId, documentId });
      setLoading(true);
      try {
        docReadyRef.current = false;
        loadedDocumentIdRef.current = null;
        setDoc(null);

        if (!loadRowDocument) {
          Log.debug('[DatabaseRowSubDocument] loadRowDocument not available', { documentId });
          return false;
        }

        const doc = await loadRowDocument(documentId, options);

        if (!isCurrent()) return false;

        if (!doc) {
          Log.debug('[DatabaseRowSubDocument] loadRowDocument returned null', { documentId });
          return false;
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
          return false;
        }

        if (!isCurrent()) return false;

        setDoc(doc);
        loadedDocumentIdRef.current = documentId;
        docReadyRef.current = true;
        rowDocEnsuredRef.current = true; // Document exists on server since we loaded it successfully
        return true;
      } catch (e) {
        Log.debug('[DatabaseRowSubDocument] loadRowDocument failed', {
          message: e instanceof Error ? e.message : String(e),
        });
        return false;
      } finally {
        if (isCurrent()) {
          setLoading(false);
        }
      }
    },
    [loadRowDocument, rowId]
  );
  // Open document with server-provided doc_state (Y.js update)
  const openDocumentWithState = useCallback(
    async (
      documentId: string,
      docState: Uint8Array,
      isCurrentRequest: IsCurrentRowDocumentRequest = ALWAYS_CURRENT_ROW_DOCUMENT_REQUEST
    ): Promise<boolean> => {
      const isCurrent = () => isCurrentRequest() && activeDocumentIdRef.current === documentId;

      if (!documentId || !isCurrent()) return false;
      try {
        docReadyRef.current = false;
        loadedDocumentIdRef.current = null;
        setDoc(null);

        // Validate docState
        if (!docState || docState.length === 0) {
          Log.warn('[DatabaseRowSubDocument] openDocumentWithState received empty docState', {
            rowId,
            documentId,
          });
          return false;
        }

        // Use cached doc to preserve sync state across reopens
        const doc = await getOrCreateRowSubDoc(documentId);

        if (!isCurrent()) return false;

        // Apply the server's doc_state to initialize the document
        // This ensures the document structure matches what the server created
        Y.applyUpdate(doc, docState);

        // Verify the document has the expected structure after applying server state
        const dataSection = doc.getMap(YjsEditorKey.data_section);
        const document = dataSection?.get(YjsEditorKey.document);

        if (!document) {
          Log.warn('[DatabaseRowSubDocument] openDocumentWithState: doc missing structure after applyUpdate', {
            rowId,
            documentId,
            hasDataSection: !!dataSection,
            dataKeys: dataSection ? Array.from(dataSection.keys()) : [],
          });
          return false;
        }

        if (!isCurrent()) return false;

        // Store metadata for sync binding
        const docWithMeta = doc as YDocWithMeta;

        docWithMeta.object_id = documentId;
        docWithMeta.view_id = documentId;
        docWithMeta._collabType = Types.Document;
        docWithMeta._syncBound = false;

        setDoc(doc);
        loadedDocumentIdRef.current = documentId;
        docReadyRef.current = true;
        rowDocEnsuredRef.current = true; // Document was created on server via createRowDocument
        Log.debug('[DatabaseRowSubDocument] openDocumentWithState ready', {
          rowId,
          documentId,
          docStateSize: docState.length,
        });
        return true;
        // eslint-disable-next-line
      } catch (e: any) {
        Log.error('[DatabaseRowSubDocument] openDocumentWithState failed', e);
        return false;
      }
    },
    [rowId]
  );

  const handleCreateDocument = useCallback(
    async (
      documentId: string,
      requireServerReady: boolean = false,
      isCurrentRequest: IsCurrentRowDocumentRequest = ALWAYS_CURRENT_ROW_DOCUMENT_REQUEST
    ): Promise<boolean> => {
      const isCurrent = () => isCurrentRequest() && activeDocumentIdRef.current === documentId;

      if (!documentId || !isCurrent()) return false;
      setLoading(true);
      let docState: Uint8Array | null = null;

      Log.debug('[DatabaseRowSubDocument] handleCreateDocument', {
        documentId,
        requireServerReady,
        hasCreateOrphanedView: !!createRowDocument,
      });

      try {
        docReadyRef.current = false;
        loadedDocumentIdRef.current = null;
        setDoc(null);

        const localHasContent = await hasLocalDocContent(documentId);

        if (!isCurrent()) return false;

        if (localHasContent) {
          Log.debug('[DatabaseRowSubDocument] local doc has content; creating server collab before binding', {
            rowId,
            documentId,
          });
        }

        if (!createRowDocument) {
          Log.debug('[DatabaseRowSubDocument] createRowDocument not available; cannot open synced row document', {
            documentId,
            requireServerReady,
          });
          return false;
        }

        try {
          Log.debug('[DatabaseRowSubDocument] calling createRowDocument', { documentId, requireServerReady });
          docState = await createRowDocument(documentId, rowDocumentSource);
        } catch (e) {
          Log.error('[DatabaseRowSubDocument] createRowDocument failed', e);
          return false;
        }

        if (!isCurrent()) return false;

        // createRowDocument swallows API errors and returns null (e.g. the server
        // hasn't persisted a freshly created row yet). Treat that as a failure so
        // the caller schedules a retry instead of binding to a structureless doc.
        if (!docState) {
          Log.warn('[DatabaseRowSubDocument] createRowDocument returned no doc state; will retry', {
            documentId,
          });
          return false;
        }

        Log.debug('[DatabaseRowSubDocument] createRowDocument success', {
          documentId,
          docStateSize: docState.length,
        });

        // Use the server-created doc_state as the only source of default document structure.
        if (docState && docState.length > 0) {
          const success = await openDocumentWithState(documentId, docState, isCurrent);

          if (success) {
            return true;
          }

          Log.warn('[DatabaseRowSubDocument] server doc_state invalid; will retry without local fallback', {
            documentId,
            docStateSize: docState.length,
          });
        }

        if (loadRowDocument) {
          const loaded = await handleOpenDocument(documentId, undefined, isCurrent);

          if (loaded) {
            return true;
          }
        }

        Log.warn('[DatabaseRowSubDocument] row document was not opened after server create', {
          documentId,
        });
        return false;
      } finally {
        if (isCurrent()) {
          setLoading(false);
        }
      }
    },
    [
      createRowDocument,
      handleOpenDocument,
      hasLocalDocContent,
      loadRowDocument,
      openDocumentWithState,
      rowDocumentSource,
      rowId,
    ]
  );

  const scheduleEnsureRowDocumentExists = useCallback(() => {
    if (!documentId || activeDocumentIdRef.current !== documentId || ensureDocRetryTimerRef.current) {
      return;
    }

    ensureDocRetryTimerRef.current = setTimeout(async () => {
      ensureDocRetryTimerRef.current = null;

      if (activeDocumentIdRef.current !== documentId) {
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
      } catch {
        // Keep retrying until the backend accepts the row document.
      }

      scheduleEnsureRowDocumentExists();
    }, 5000);
  }, [
    checkIfRowDocumentExists,
    createRowDocument,
    documentId,
    isDocumentEmpty,
    rowDocumentSource,
    updateRowMeta,
    rowId,
  ]);

  // Drop every trace of the previous document as soon as documentId changes, so
  // the editor never renders or binds the old row's doc while the new one loads.
  useEffect(() => {
    docReadyRef.current = false;
    loadedDocumentIdRef.current = null;
    editorRef.current = null;
    lastIsEmptyRef.current = null;
    pendingNonEmptyRef.current = false;
    rowDocEnsuredRef.current = false;

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
    setLoading(Boolean(documentId));
  }, [documentId]);

  useEffect(() => {
    if (!documentId) return;

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

    const scheduleRetry = (loadOptions?: LoadRowDocumentOptions) => {
      if (retryLoadTimerRef.current) return;
      retryLoadTimerRef.current = setTimeout(async () => {
        if (!isCurrentRequest()) return;

        // If doc is already loaded (e.g., by handleCreateDocument), skip retry
        // This prevents resetting the editor mid-typing
        if (docReadyRef.current && loadedDocumentIdRef.current === documentId) {
          Log.debug('[DatabaseRowSubDocument] skipping retry - doc already loaded', {
            rowId,
            documentId,
          });
          retryLoadTimerRef.current = null;
          return;
        }

        retryCount++;

        // A newly-created row can reach this component before its row collab has
        // propagated to the server. In that case the initial create request is
        // rejected because the server cannot resolve the row yet. Retrying a
        // load first is both unnecessary (the meta already says the document is
        // empty) and slow enough to keep the editor skeleton visible for the
        // entire retry window, so retry creation directly after propagation has
        // had another chance to complete.
        const retryingEmptyDocument = isDocumentEmptyResolved === true;
        const retried = retryingEmptyDocument
          ? await handleCreateDocument(documentId, false, isCurrentRequest)
          : await handleOpenDocument(documentId, loadOptions, isCurrentRequest);

        if (retried || !isCurrentRequest()) {
          return;
        }

        retryLoadTimerRef.current = null;

        if (retryCount >= MAX_RETRIES) {
          // Empty documents already attempted server creation on every retry.
          // Stop here so a permanently rejected row cannot keep issuing an
          // orphan-creation request every two seconds while the modal is open.
          if (retryingEmptyDocument) {
            Log.warn('[DatabaseRowSubDocument] max retries reached; row document creation rejected', {
              rowId,
              documentId,
              retryCount,
            });
            return;
          }

          // For non-empty documents, make one final create attempt after the
          // bounded load retries. The server doc_state remains the only source
          // of the default document structure.
          const localHasContent = await hasLocalDocContent(documentId);

          if (!isCurrentRequest()) return;

          if (localHasContent) {
            Log.debug('[DatabaseRowSubDocument] max retries reached; local content found, creating server doc before binding', {
              rowId,
              documentId,
              retryCount,
            });
          }

          Log.debug('[DatabaseRowSubDocument] max retries reached; creating document', {
            rowId,
            documentId,
            retryCount,
          });
          const created = await handleCreateDocument(documentId, true, isCurrentRequest);

          if (!created && isCurrentRequest()) {
            Log.warn('[DatabaseRowSubDocument] final row document creation attempt rejected', {
              rowId,
              documentId,
              retryCount,
            });
          }

          return;
        }

        scheduleRetry(loadOptions);
      }, 2000); // Reduced from 5000ms to 2000ms for faster response
    };

    void (async () => {
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

      if (isDocumentEmptyResolved) {
        // Skip if doc is already loaded
        if (docReadyRef.current && loadedDocumentIdRef.current === documentId) {
          Log.debug('[DatabaseRowSubDocument] row meta says empty but doc already loaded, skipping', {
            rowId,
            documentId,
          });
          return;
        }

        // Document is empty, but the editor must still bind to a server-side
        // collab before accepting edits. Otherwise a paste-and-close flow can
        // enqueue the first update before the orphaned collab exists, then a
        // fast reopen loads the still-empty server state over the local cache.
        Log.debug('[DatabaseRowSubDocument] row meta says empty; creating row doc before opening editor', {
          rowId,
          documentId,
        });
        const created = await handleCreateDocument(documentId, false, isCurrentRequest);

        if (!created && isCurrentRequest()) {
          scheduleRetry();
        }

        return;
      }

      // meta.isEmptyDocument is false - document should exist on server
      // If checkIfRowDocumentExists is not available, try to load directly.
      if (!checkIfRowDocumentExists) {
        const localHasContent = await hasLocalDocContent(documentId);

        if (!isCurrentRequest()) return;

        if (localHasContent) {
          Log.debug('[DatabaseRowSubDocument] doc not found; local content found, creating server doc before binding', {
            rowId,
            documentId,
          });
        }

        void (async () => {
          const created = await handleCreateDocument(documentId, true, isCurrentRequest);

          if (!created && isCurrentRequest()) {
            scheduleRetry();
          }
        })();

        return;
      }

      try {
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

          // A positive existence check means the collab object is already
          // present. Do one read attempt, then repair its row-document
          // registration and open the returned state instead of waiting
          // through the duplication-oriented backoff loop.
          const success = await handleOpenDocument(documentId, CONFIRMED_ROW_DOCUMENT_LOAD_OPTIONS, isCurrentRequest);

          if (!success && isCurrentRequest()) {
            Log.debug('[DatabaseRowSubDocument] repairing row document after load failure', {
              rowId,
              documentId,
            });
            const repaired = await handleCreateDocument(documentId, true, isCurrentRequest);

            if (!repaired && isCurrentRequest()) {
              scheduleRetry(CONFIRMED_ROW_DOCUMENT_LOAD_OPTIONS);
            }
          }

          return;
        }

        // Document doesn't exist on server but meta says non-empty
        Log.debug('[DatabaseRowSubDocument] meta says non-empty but doc not found; will retry then create', {
          rowId,
          documentId,
        });
        // Retry a few times in case of race condition, will create after max retries
        scheduleRetry();
      } catch (e) {
        if (!isCurrentRequest()) return;

        Log.debug('[DatabaseRowSubDocument] checkIfRowDocumentExists failed; will retry', {
          rowId,
          documentId,
        });
        scheduleRetry();
      }
    })();

    return () => {
      cancelled = true;
      clearRetryTimer();
    };
  }, [
    handleOpenDocument,
    documentId,
    handleCreateDocument,
    checkIfRowDocumentExists,
    isDocumentEmptyResolved,
    hasLocalDocContent,
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
    if (!documentId || activeDocumentIdRef.current !== documentId) return false;

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
      } catch {
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
      } catch {
        // Creation failed - don't mark as ensured so we can retry
        return false;
      }
    }

    return false;
  }, [checkIfRowDocumentExists, createRowDocument, documentId, rowDocumentSource]);

  useEffect(() => {
    if (!doc || !documentId || !loadedDocMatchesCurrent) return;

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

    const handleDocUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin !== CollabOrigin.Local && origin !== CollabOrigin.LocalManual) {
        return;
      }

      if (pendingMetaUpdateRef.current) {
        clearTimeout(pendingMetaUpdateRef.current);
      }

      pendingMetaUpdateRef.current = setTimeout(flushPendingMetaUpdate, 0);
    };

    doc.on('update', handleDocUpdate);
    onRegisterPendingMetaFlush?.(flushPendingMetaUpdate);

    return () => {
      doc.off('update', handleDocUpdate);
      // Flush — not cancel — so a close-card immediately after paste still
      // marks the row non-empty and registers the orphan collab on the server.
      flushPendingMetaUpdate();
      onRegisterPendingMetaFlush?.(null);
    };
  }, [
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
  ]);

  useEffect(() => {
    return () => {
      if (ensureDocRetryTimerRef.current) {
        clearTimeout(ensureDocRetryTimerRef.current);
        ensureDocRetryTimerRef.current = null;
      }
    };
  }, []);

  if (loading || (doc && documentId && !loadedDocMatchesCurrent)) {
    return <EditorSkeleton />;
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
