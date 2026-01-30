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
  YjsEditorKey,
} from '@/application/types';
import { EditorSkeleton } from '@/components/_shared/skeleton/EditorSkeleton';
import { YDocWithMeta } from '@/components/app/hooks/useViewOperations';
import { Editor } from '@/components/editor';
import { useCurrentUser } from '@/components/main/app.hooks';

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
        console.warn('[DatabaseRowSubDocument] loadView failed, will create locally:', e.message);
        return false;
      } finally {
        setLoading(false);
      }
    },
    [loadView]
  );
  const handleCreateDocument = useCallback(
    async (documentId: string) => {
      if (!documentId) return;
      setLoading(true);
      try {
        setDoc(null);

        // Try to create the orphaned view on the server if the function is available
        // This is optional - the document will sync via WebSocket when Editor binds
        if (createOrphanedView) {
          try {
            await createOrphanedView({ document_id: documentId });
          } catch (e) {
            // Server creation failed, but we can still create locally
            console.warn('[DatabaseRowSubDocument] createOrphanedView failed, creating locally:', e);
          }
        }

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
        // eslint-disable-next-line
      } catch (e: any) {
        console.error('[DatabaseRowSubDocument] handleCreateDocument failed', e);
      } finally {
        setLoading(false);
      }
    },
    [createOrphanedView]
  );

  useEffect(() => {
    if (!documentId) return;

    let cancelled = false;

    const clearRetryTimer = () => {
      if (retryLoadTimerRef.current) {
        clearTimeout(retryLoadTimerRef.current);
        retryLoadTimerRef.current = null;
      }
    };

    const scheduleRetry = (createIfStillMissing: boolean) => {
      if (retryLoadTimerRef.current) return;
      retryLoadTimerRef.current = setTimeout(async () => {
        if (cancelled) return;
        const retried = await handleOpenDocument(documentId);
        if (retried || cancelled) {
          return;
        }
        retryLoadTimerRef.current = null;
        if (createIfStillMissing) {
          void handleCreateDocument(documentId);
          return;
        }
        scheduleRetry(createIfStillMissing);
      }, 5000);
    };

    const shouldWaitForRowMeta = !isDocumentEmptyResolved;

    void (async () => {
      if (isDocumentEmptyResolved) {
        void handleCreateDocument(documentId);
        return;
      }

      // If checkIfRowDocumentExists is not available, decide based on row meta.
      if (!checkIfRowDocumentExists) {
        if (shouldWaitForRowMeta) {
          scheduleRetry(false);
          return;
        }
        void handleCreateDocument(documentId);
        return;
      }

      try {
        const exists = await checkIfRowDocumentExists(documentId);
        if (exists) {
          const success = await handleOpenDocument(documentId);
          if (!success) {
            if (createOrphanedView) {
              try {
                await createOrphanedView({ document_id: documentId });
              } catch {
                // Ignore; we'll retry loadView below.
              }
            }
            scheduleRetry(!shouldWaitForRowMeta);
          }
          return;
        }

        if (shouldWaitForRowMeta) {
          scheduleRetry(false);
          return;
        }
        void handleCreateDocument(documentId);
      } catch (e) {
        if (shouldWaitForRowMeta) {
          scheduleRetry(false);
          return;
        }
        void handleCreateDocument(documentId);
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
  ]);

  useEffect(() => {
    if (loading || !doc || !documentId || !bindViewSync) return;

    const docWithMeta = doc as YDocWithMeta;

    if (docWithMeta.object_id && docWithMeta.object_id !== documentId) {
      return;
    }

    bindViewSync(doc);
  }, [loading, doc, documentId, bindViewSync]);

  const getMoreAIContext = useCallback(() => {
    return JSON.stringify(properties);
  }, [properties]);

  const isDocumentEmpty = useCallback((editor: YjsEditor) => {
    const children = editor.children;

    if (children.length === 0) {
      return true;
    }

    if (children.length === 1) {
      const firstChildBlockType = 'type' in children[0] ? (children[0].type as BlockType) : BlockType.Paragraph;

      if (firstChildBlockType !== BlockType.Paragraph) {
        return false;
      }

      return true;
    }

    return false;
  }, []);

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

        if (!exists && createOrphanedView) {
          await createOrphanedView({ document_id: documentId });
        }

        if (pendingNonEmptyRef.current) {
          const editor = editorRef.current;
          if (editor && !isDocumentEmpty(editor)) {
            lastIsEmptyRef.current = false;
            pendingNonEmptyRef.current = false;
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
  }, [checkIfRowDocumentExists, createOrphanedView, documentId, isDocumentEmpty, updateRowMeta]);

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
          updateRowMeta(RowMetaKey.IsDocumentEmpty, isEmpty);
          return;
        }

        void (async () => {
          const ensured = await ensureRowDocumentExists();

          if (ensured) {
            lastIsEmptyRef.current = isEmpty;
            pendingNonEmptyRef.current = false;
            updateRowMeta(RowMetaKey.IsDocumentEmpty, isEmpty);
            return;
          }

          pendingNonEmptyRef.current = true;
          scheduleEnsureRowDocumentExists();
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
