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
import { getCachedRowSubDoc, getOrCreateRowSubDoc } from '@/application/services/js-services/cache';
import { YjsEditor } from '@/application/slate-yjs';
import { initializeDocumentStructure } from '@/application/slate-yjs/utils/yjs';
import {
  BlockType,
  CollabOrigin,
  Types,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey
} from '@/application/types';
import { useCurrentWorkspaceIdOptional } from '@/components/app/app.hooks';
import { EditorSkeleton } from '@/components/_shared/skeleton/EditorSkeleton';
import { YDocWithMeta } from '@/components/database/hooks';
import { Editor } from '@/components/editor';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Log } from '@/utils/log';

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
export const DatabaseRowSubDocument = memo(({ rowId }: { rowId: string }) => {
  const meta = useRowMetaSelector(rowId);
  const documentId = meta?.documentId;
  const database = useDatabase();
  const row = useRowData(rowId) as YDatabaseRow | undefined;
  const currentUser = useCurrentUserOptional();
  const workspaceId = useCurrentWorkspaceIdOptional();

  // Get context for Editor props and row document operations
  // The context provides mode-specific implementations:
  // - App mode: authenticated APIs, WebSocket sync
  // - Publish mode: published cache, no writes
  const context = useDatabaseContextOptional();

  // Row document operations from context (mode-specific implementations)
  const loadRowDocument = context?.loadRowDocument;
  const createRowDocument = context?.createRowDocument;
  const checkIfRowDocumentExists = context?.checkIfRowDocumentExists;
  const bindViewSync = context?.bindViewSync;
  const updateRowMeta = useUpdateRowMetaDispatch(rowId);
  const editorRef = useRef<YjsEditor | null>(null);
  const lastIsEmptyRef = useRef<boolean | null>(null);
  const pendingMetaUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingNonEmptyRef = useRef(false);
  const pendingOpenLocalRef = useRef(false);
  const docReadyRef = useRef(false); // Track if document is loaded to prevent retry timer from resetting it
  const rowDocEnsuredRef = useRef(false); // Track if row document has been ensured on server to avoid redundant API calls

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

  const document = doc?.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.document);
  // undefined = meta hasn't loaded from Yjs yet (wait)
  // true = meta loaded, document is empty (open locally)
  // false = meta loaded, document has content (load from server)
  const isDocumentEmptyResolved = meta === null || meta === undefined ? undefined : (meta.isEmptyDocument ?? true);

  const isDocumentEmpty = useCallback(
    (editor: YjsEditor) => {
      // Only trust meta if it says NOT empty (false) - once content was added, it stays not-empty
      // If meta says empty (true) or undefined, we must check actual content
      if (meta?.isEmptyDocument === false) {
        return false;
      }

      const children = editor.children;

      if (children.length === 0) {
        return true;
      }

      if (children.length === 1) {
        const firstChild = children[0];
        const firstChildBlockType = 'type' in firstChild ? (firstChild.type as BlockType) : BlockType.Paragraph;

        if (firstChildBlockType !== BlockType.Paragraph) {
          return false;
        }

        // Check if the paragraph has any text content
        // AppFlowy Slate structure: paragraph -> text node (type: 'text') -> leaf nodes ({text: '...'})
        if ('children' in firstChild && Array.isArray(firstChild.children)) {
          const hasContent = firstChild.children.some((child: unknown) => {
            // Check for direct leaf node with text property (standard Slate)
            if (typeof child === 'object' && child !== null && 'text' in child) {
              return (child as { text: string }).text.length > 0;
            }

            // Check for AppFlowy text node structure: {type: 'text', children: [{text: '...'}]}
            if (
              typeof child === 'object' &&
              child !== null &&
              'type' in child &&
              (child as { type: string }).type === 'text' &&
              'children' in child &&
              Array.isArray((child as { children: unknown[] }).children)
            ) {
              const textNode = child as { children: Array<{ text?: string }> };

              return textNode.children.some((leaf) => leaf.text && leaf.text.length > 0);
            }

            return true; // Non-text nodes (embeds, etc.) count as content
          });

          return !hasContent;
        }

        return true;
      }

      return false;
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
            const type = block.get(YjsEditorKey.block_type);

            if (type && type !== BlockType.Page && type !== BlockType.Paragraph) {
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
    async (documentId: string): Promise<boolean> => {
      Log.debug('[DatabaseRowSubDocument] handleOpenDocument start', { rowId, documentId });
      setLoading(true);
      try {
        docReadyRef.current = false;
        setDoc(null);

        if (!loadRowDocument) {
          Log.debug('[DatabaseRowSubDocument] loadRowDocument not available', { documentId });
          return false;
        }

        const doc = await loadRowDocument(documentId);

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

        setDoc(doc);
        docReadyRef.current = true;
        rowDocEnsuredRef.current = true; // Document exists on server since we loaded it successfully
        return true;
      } catch (e) {
        Log.debug('[DatabaseRowSubDocument] loadRowDocument failed', { message: e instanceof Error ? e.message : String(e) });
        return false;
      } finally {
        setLoading(false);
      }
    },
    [loadRowDocument, rowId]
  );
  // Open document with server-provided doc_state (Y.js update)
  const openDocumentWithState = useCallback(
    async (documentId: string, docState: Uint8Array): Promise<boolean> => {
      if (!documentId) return false;
      try {
        docReadyRef.current = false;
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

        // Store metadata for sync binding
        const docWithMeta = doc as YDocWithMeta;

        docWithMeta.object_id = documentId;
        docWithMeta._collabType = Types.Document;
        docWithMeta._syncBound = false;

        setDoc(doc);
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

  // Fallback: Open document with local structure (when server unavailable)
  const openLocalDocument = useCallback(
    async (documentId: string) => {
      if (!documentId) return;
      try {
        docReadyRef.current = false;
        setDoc(null);

        // Use cached doc to preserve sync state across reopens
        // This ensures the same Y.Doc instance is reused when reopening,
        // preventing content loss from "different doc instance" sync replacement
        const doc = await getOrCreateRowSubDoc(documentId);

        // Initialize with empty document structure if needed
        // Pass true to include initial paragraph - required for Slate editor to render
        // Pass documentId to ensure page_id matches server's algorithm
        initializeDocumentStructure(doc, true, documentId);

        // Store metadata for sync binding
        const docWithMeta = doc as YDocWithMeta;

        docWithMeta.object_id = documentId;
        docWithMeta._collabType = Types.Document;
        docWithMeta._syncBound = false;

        setDoc(doc);
        docReadyRef.current = true;
        Log.debug('[DatabaseRowSubDocument] openLocalDocument ready', {
          rowId,
          documentId,
        });
        // eslint-disable-next-line
      } catch (e: any) {
        Log.error('[DatabaseRowSubDocument] openLocalDocument failed', e);
      }
    },
    [rowId]
  );

  const handleCreateDocument = useCallback(
    async (documentId: string, requireServerReady: boolean = false): Promise<boolean> => {
      if (!documentId) return false;
      setLoading(true);
      let opened = false;
      let docState: Uint8Array | null = null;

      Log.debug('[DatabaseRowSubDocument] handleCreateDocument', {
        documentId,
        requireServerReady,
        hasCreateOrphanedView: !!createRowDocument,
      });

      try {
        docReadyRef.current = false;
        setDoc(null);

        const localHasContent = await hasLocalDocContent(documentId);

        if (localHasContent) {
          Log.debug('[DatabaseRowSubDocument] local doc has content; skipping server create', {
            rowId,
            documentId,
          });
          await openLocalDocument(documentId);
          opened = true;
          return true;
        }

        if (requireServerReady) {
          if (!createRowDocument) {
            Log.debug('[DatabaseRowSubDocument] createRowDocument not available, returning false');
            setLoading(false); // Clear loading on early failure
            return false;
          }

          try {
            Log.debug('[DatabaseRowSubDocument] calling createRowDocument', { documentId });
            docState = await createRowDocument(documentId);
            Log.debug('[DatabaseRowSubDocument] createRowDocument success', { documentId, docStateSize: docState?.length ?? 0 });
          } catch (e) {
            Log.error('[DatabaseRowSubDocument] createRowDocument failed', e);
            setLoading(false); // Clear loading on error
            return false;
          }
        } else if (createRowDocument) {
          try {
            Log.debug('[DatabaseRowSubDocument] calling createRowDocument (non-blocking)', { documentId });
            docState = await createRowDocument(documentId);
            Log.debug('[DatabaseRowSubDocument] createRowDocument success (non-blocking)', { documentId, docStateSize: docState?.length ?? 0 });
          } catch (e) {
            Log.warn('[DatabaseRowSubDocument] createRowDocument failed (continuing)', e);
            // Continue to local document if server create fails.
          }
        }

        // Use server's doc_state if available, otherwise create structure locally
        if (docState && docState.length > 0) {
          const success = await openDocumentWithState(documentId, docState);

          if (!success) {
            Log.warn('[DatabaseRowSubDocument] server doc_state invalid, falling back to local', {
              documentId,
              docStateSize: docState.length,
            });
            await openLocalDocument(documentId);
          }
        } else {
          await openLocalDocument(documentId);
        }

        opened = true;
        return true;
      } finally {
        if (opened || !requireServerReady) {
          setLoading(false);
        }
      }
    },
    [createRowDocument, hasLocalDocContent, openDocumentWithState, openLocalDocument, rowId]
  );

  const scheduleEnsureRowDocumentExists = useCallback(() => {
    if (!documentId || ensureDocRetryTimerRef.current) {
      return;
    }

    ensureDocRetryTimerRef.current = setTimeout(async () => {
      ensureDocRetryTimerRef.current = null;

      try {
        const exists = checkIfRowDocumentExists
          ? await checkIfRowDocumentExists(documentId)
          : false;

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
          await createRowDocument(documentId);
        }

        if (pendingOpenLocalRef.current && (exists || createRowDocument)) {
          pendingOpenLocalRef.current = false;
          await openLocalDocument(documentId);
          setLoading(false);
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
    updateRowMeta,
    openLocalDocument,
    rowId,
  ]);

  useEffect(() => {
    if (!documentId) return;

    // Reset ensured state when documentId changes
    rowDocEnsuredRef.current = false;

    let cancelled = false;
    let retryCount = 0;
    const MAX_RETRIES = 3;

    const clearRetryTimer = () => {
      if (retryLoadTimerRef.current) {
        clearTimeout(retryLoadTimerRef.current);
        retryLoadTimerRef.current = null;
      }
    };

    const scheduleRetry = () => {
      if (retryLoadTimerRef.current) return;
      retryLoadTimerRef.current = setTimeout(async () => {
        if (cancelled) return;

        // If doc is already loaded (e.g., by handleCreateDocument), skip retry
        // This prevents resetting the editor mid-typing
        if (docReadyRef.current) {
          Log.debug('[DatabaseRowSubDocument] skipping retry - doc already loaded', {
            rowId,
            documentId,
          });
          retryLoadTimerRef.current = null;
          return;
        }

        retryCount++;

        const retried = await handleOpenDocument(documentId);

        if (retried || cancelled) {
          return;
        }

        retryLoadTimerRef.current = null;

        // After max retries, create the document anyway unless we already have local content
        if (retryCount >= MAX_RETRIES) {
          const localHasContent = await hasLocalDocContent(documentId);

          if (localHasContent) {
            Log.debug('[DatabaseRowSubDocument] max retries reached; local content found, opening local doc', {
              rowId,
              documentId,
              retryCount,
            });
            await openLocalDocument(documentId);
            setLoading(false);
            return;
          }

          Log.debug('[DatabaseRowSubDocument] max retries reached; creating document', {
            rowId,
            documentId,
            retryCount,
          });
          void handleCreateDocument(documentId, true);
          return;
        }

        scheduleRetry();
      }, 2000); // Reduced from 5000ms to 2000ms for faster response
    };

    void (async () => {
      // Skip if doc is already loaded - prevents reloading when meta changes
      if (docReadyRef.current && doc) {
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
        if (docReadyRef.current) {
          Log.debug('[DatabaseRowSubDocument] row meta says empty but doc already loaded, skipping', {
            rowId,
            documentId,
          });
          return;
        }

        // Document is empty - just open locally without creating on server.
        // The server document will be created when user actually edits (via handleDocUpdate).
        Log.debug('[DatabaseRowSubDocument] row meta says empty; opening local doc only (no API call)', {
          rowId,
          documentId,
        });
        await openLocalDocument(documentId);
        setLoading(false);

        return;
      }

      // meta.isEmptyDocument is false - document should exist on server
      // If checkIfRowDocumentExists is not available, try to load directly.
      if (!checkIfRowDocumentExists) {
        const localHasContent = await hasLocalDocContent(documentId);

        if (localHasContent) {
          Log.debug('[DatabaseRowSubDocument] doc not found; local content found, opening local doc', {
            rowId,
            documentId,
          });
          await openLocalDocument(documentId);
          setLoading(false);
          return;
        }

        void handleCreateDocument(documentId, true);
        return;
      }

      try {
        const exists = await checkIfRowDocumentExists(documentId);

        Log.debug('[DatabaseRowSubDocument] checkIfRowDocumentExists', {
          rowId,
          documentId,
          exists,
        });
        if (exists) {
          // Skip loading if doc is already ready
          if (docReadyRef.current) {
            Log.debug('[DatabaseRowSubDocument] doc exists and already loaded, skipping', {
              rowId,
              documentId,
            });
            return;
          }

          const success = await handleOpenDocument(documentId);

          if (!success) {
            if (createRowDocument) {
              try {
                Log.debug('[DatabaseRowSubDocument] createRowDocument after load failure', {
                  rowId,
                  documentId,
                });
                await createRowDocument(documentId);
              } catch {
                // Ignore; we'll retry loading below.
              }
            }

            scheduleRetry();
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
    scheduleEnsureRowDocumentExists,
    createRowDocument,
    rowId,
    doc,
    openLocalDocument,
  ]);

  useEffect(() => {
    if (loading || !doc || !documentId || !bindViewSync) {
      Log.debug('[DatabaseRowSubDocument] bindViewSync skipped', {
        rowId,
        documentId,
        loading,
        hasDoc: !!doc,
        hasBindViewSync: !!bindViewSync,
      });
      return;
    }

    const docWithMeta = doc as YDocWithMeta;

    if (docWithMeta.object_id && docWithMeta.object_id !== documentId) {
      Log.debug('[DatabaseRowSubDocument] bindViewSync doc id mismatch', {
        rowId,
        documentId,
        objectId: docWithMeta.object_id,
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
  }, [loading, doc, documentId, bindViewSync, rowId]);

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
    if (!documentId) return false;

    // Skip if we've already ensured this document exists (memoize to avoid redundant API calls)
    if (rowDocEnsuredRef.current) {
      return true;
    }

    let exists = false;

    if (checkIfRowDocumentExists) {
      try {
        exists = await checkIfRowDocumentExists(documentId);
      } catch {
        // Ignore and fall through to orphaned view creation attempt.
      }
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
        await createRowDocument(documentId);
        rowDocEnsuredRef.current = true;
        return true;
      } catch {
        // Creation failed - don't mark as ensured so we can retry
        return false;
      }
    }

    return false;
  }, [checkIfRowDocumentExists, createRowDocument, documentId]);

  useEffect(() => {
    if (!doc) return;

    const handleDocUpdate = (_update: Uint8Array, origin: unknown) => {
      if (origin !== CollabOrigin.Local && origin !== CollabOrigin.LocalManual) {
        return;
      }

      if (pendingMetaUpdateRef.current) {
        clearTimeout(pendingMetaUpdateRef.current);
      }

      pendingMetaUpdateRef.current = setTimeout(() => {
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
          const ensured = await ensureRowDocumentExists();

          lastIsEmptyRef.current = isEmpty;
          pendingNonEmptyRef.current = false;
          Log.debug('[DatabaseRowSubDocument] row document edited', {
            rowId,
            documentId,
          });
          Log.debug('[DatabaseRowSubDocument] row document non-empty -> update meta', {
            rowId,
            documentId,
            ensured,
          });
          updateRowMeta(RowMetaKey.IsDocumentEmpty, isEmpty);

          if (!ensured) {
            scheduleEnsureRowDocumentExists();
          }
        })();
      }, 0);
    };

    doc.on('update', handleDocUpdate);

    return () => {
      doc.off('update', handleDocUpdate);
      if (pendingMetaUpdateRef.current) {
        clearTimeout(pendingMetaUpdateRef.current);
        pendingMetaUpdateRef.current = null;
      }
    };
  }, [
    doc,
    documentId,
    rowId,
    isDocumentEmpty,
    shouldSkipIsDocumentEmptyUpdate,
    updateRowMeta,
    ensureRowDocumentExists,
    scheduleEnsureRowDocumentExists,
  ]);

  useEffect(() => {
    return () => {
      if (ensureDocRetryTimerRef.current) {
        clearTimeout(ensureDocRetryTimerRef.current);
        ensureDocRetryTimerRef.current = null;
      }
    };
  }, []);

  if (loading) {
    return <EditorSkeleton />;
  }

  if (!document || !doc || !documentId || !row || !workspaceId || !context) return null;

  return (
    <Editor
      {...context}
      fullWidth
      workspaceId={workspaceId}
      viewId={documentId}
      doc={doc}
      readOnly={false}
      getMoreAIContext={getMoreAIContext}
      onEditorConnected={handleEditorConnected}
    />
  );
});

export default DatabaseRowSubDocument;
