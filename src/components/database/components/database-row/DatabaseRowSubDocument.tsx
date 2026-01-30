import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  FieldType,
  getRowTimeString,
  RowMetaKey,
  useDatabase,
  useDatabaseContext,
  useReadOnly,
  useRowData,
  useRowMetaSelector,
} from '@/application/database-yjs';
import { getCellDataText } from '@/application/database-yjs/cell.parse';
import { useUpdateRowMetaDispatch } from '@/application/database-yjs/dispatch';
import { openCollabDB } from '@/application/db';
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
import { EditorSkeleton } from '@/components/_shared/skeleton/EditorSkeleton';
import { YDocWithMeta } from '@/components/app/hooks/useViewOperations';
import { Editor } from '@/components/editor';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Log } from '@/utils/log';

export const DatabaseRowSubDocument = memo(({ rowId }: { rowId: string }) => {
  const meta = useRowMetaSelector(rowId);
  const readOnly = useReadOnly();
  const documentId = meta?.documentId;
  const context = useDatabaseContext();
  const database = useDatabase();
  const row = useRowData(rowId) as YDatabaseRow | undefined;
  const checkIfRowDocumentExists = context.checkIfRowDocumentExists;
  const { createOrphanedView, loadView, bindViewSync } = context;
  const currentUser = useCurrentUser();
  const updateRowMeta = useUpdateRowMetaDispatch(rowId);
  const editorRef = useRef<YjsEditor | null>(null);
  const lastIsEmptyRef = useRef<boolean | null>(null);
  const pendingMetaUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingNonEmptyRef = useRef(false);
  const pendingOpenLocalRef = useRef(false);

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
  const isDocumentEmptyResolved = meta?.isEmptyDocument ?? false;

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

  const handleOpenDocument = useCallback(
    async (documentId: string): Promise<boolean> => {
      if (!loadView) return false;
      setLoading(true);
      try {
        setDoc(null);
        const doc = await loadView(documentId, true);

        setDoc(doc);
        return true;
        // eslint-disable-next-line
      } catch (e: any) {
        // Don't show error toast - caller will fall back to creating document
        Log.debug('[DatabaseRowSubDocument] loadView failed, will create locally', { message: e.message });
        return false;
      } finally {
        setLoading(false);
      }
    },
    [loadView]
  );
  const openLocalDocument = useCallback(
    async (documentId: string) => {
      if (!documentId) return;
      try {
        setDoc(null);

        // Open the document from IndexedDB (not from server)
        // This is faster and more reliable for newly created documents
        const doc = await openCollabDB(documentId);

        // Initialize with empty document structure if needed
        // Pass true to include initial paragraph - required for Slate editor to render
        initializeDocumentStructure(doc, true);

        // Store metadata for sync binding (matches loadView behavior)
        const docWithMeta = doc as YDocWithMeta;

        docWithMeta.object_id = documentId;
        docWithMeta._collabType = Types.Document;
        docWithMeta._syncBound = false;

        setDoc(doc);
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

      Log.debug('[DatabaseRowSubDocument] handleCreateDocument', {
        documentId,
        requireServerReady,
        hasCreateOrphanedView: !!createOrphanedView,
      });

      try {
        setDoc(null);

        if (requireServerReady) {
          if (!createOrphanedView) {
            Log.debug('[DatabaseRowSubDocument] createOrphanedView not available, returning false');
            return false;
          }

          try {
            Log.debug('[DatabaseRowSubDocument] calling createOrphanedView', { documentId });
            await createOrphanedView({ document_id: documentId });
            Log.debug('[DatabaseRowSubDocument] createOrphanedView success', { documentId });
          } catch (e) {
            Log.error('[DatabaseRowSubDocument] createOrphanedView failed', e);
            return false;
          }
        } else if (createOrphanedView) {
          try {
            Log.debug('[DatabaseRowSubDocument] calling createOrphanedView (non-blocking)', { documentId });
            await createOrphanedView({ document_id: documentId });
            Log.debug('[DatabaseRowSubDocument] createOrphanedView success (non-blocking)', { documentId });
          } catch (e) {
            Log.warn('[DatabaseRowSubDocument] createOrphanedView failed (continuing)', e);
            // Continue to local document if server create fails.
          }
        }

        await openLocalDocument(documentId);
        opened = true;
        return true;
      } finally {
        if (opened || !requireServerReady) {
          setLoading(false);
        }
      }
    },
    [createOrphanedView, openLocalDocument]
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

        if (!exists && createOrphanedView) {
          Log.debug('[DatabaseRowSubDocument] createOrphanedView retry', {
            rowId,
            documentId,
          });
          await createOrphanedView({ document_id: documentId });
        }

        if (pendingOpenLocalRef.current && (exists || createOrphanedView)) {
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
    createOrphanedView,
    documentId,
    isDocumentEmpty,
    updateRowMeta,
    openLocalDocument,
    rowId,
  ]);

  useEffect(() => {
    if (!documentId) return;

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
        retryCount++;

        const retried = await handleOpenDocument(documentId);

        if (retried || cancelled) {
          return;
        }

        retryLoadTimerRef.current = null;

        // After max retries, create the document anyway
        if (retryCount >= MAX_RETRIES) {
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

    const shouldWaitForRowMeta = !isDocumentEmptyResolved;

    void (async () => {
      if (isDocumentEmptyResolved) {
        Log.debug('[DatabaseRowSubDocument] row meta says empty; creating local doc', {
          rowId,
          documentId,
        });
        const created = await handleCreateDocument(documentId, true);

        if (!created) {
          pendingOpenLocalRef.current = true;
          scheduleEnsureRowDocumentExists();
        }

        return;
      }

      // If checkIfRowDocumentExists is not available, decide based on row meta.
      if (!checkIfRowDocumentExists) {
        if (shouldWaitForRowMeta) {
          scheduleRetry();
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
          shouldWaitForRowMeta,
        });
        if (exists) {
          const success = await handleOpenDocument(documentId);

          if (!success) {
            if (createOrphanedView) {
              try {
                Log.debug('[DatabaseRowSubDocument] createOrphanedView after load failure', {
                  rowId,
                  documentId,
                });
                await createOrphanedView({ document_id: documentId });
              } catch {
                // Ignore; we'll retry loadView below.
              }
            }

            scheduleRetry();
          }

          return;
        }

        // Document doesn't exist on server
        if (shouldWaitForRowMeta) {
          Log.debug('[DatabaseRowSubDocument] row meta says non-empty but doc not found; will retry then create', {
            rowId,
            documentId,
          });
          // Still retry a few times in case of race condition, but will create after max retries
          scheduleRetry();
          return;
        }

        void handleCreateDocument(documentId, true);
      } catch (e) {
        if (shouldWaitForRowMeta) {
          Log.debug('[DatabaseRowSubDocument] checkIfRowDocumentExists failed; will retry then create', {
            rowId,
            documentId,
          });
          scheduleRetry();
          return;
        }

        void handleCreateDocument(documentId, true);
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
    scheduleEnsureRowDocumentExists,
    createOrphanedView,
    rowId,
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
      if (readOnly) {
        return true;
      }

      if (meta?.isEmptyDocument === false && isEmpty) {
        return true;
      }

      return false;
    },
    [meta?.isEmptyDocument, readOnly]
  );

  const handleEditorConnected = useCallback((editor: YjsEditor) => {
    editorRef.current = editor;
  }, []);

  const ensureRowDocumentExists = useCallback(async () => {
    if (!documentId) return false;

    let exists = false;

    if (checkIfRowDocumentExists) {
      try {
        exists = await checkIfRowDocumentExists(documentId);
      } catch {
        // Ignore and fall through to orphaned view creation attempt.
      }
    }

    if (createOrphanedView) {
      try {
        await createOrphanedView({ document_id: documentId });
        return true;
      } catch {
        // Fall back to "exists" if we can at least confirm collab presence.
        return exists;
      }
    }

    return exists;
  }, [checkIfRowDocumentExists, createOrphanedView, documentId]);

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

  if (!document || !doc || !documentId || !row) return null;
  return (
    <Editor
      {...context}
      fullWidth
      viewId={documentId}
      doc={doc}
      readOnly={readOnly}
      getMoreAIContext={getMoreAIContext}
      onEditorConnected={handleEditorConnected}
    />
  );
});

export default DatabaseRowSubDocument;
