import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';

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
import { YjsEditor } from '@/application/slate-yjs';
import {
  BlockType,
  CollabOrigin,
  YDatabaseCell,
  YDatabaseField,
  YDatabaseRow,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { EditorSkeleton } from '@/components/_shared/skeleton/EditorSkeleton';
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
  const { createOrphanedView, loadView } = context;
  const currentUser = useCurrentUser();
  const updateRowMeta = useUpdateRowMetaDispatch(rowId);
  const editorRef = useRef<YjsEditor | null>(null);
  const lastIsEmptyRef = useRef<boolean | null>(null);
  const pendingMetaUpdateRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const document = doc?.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.document);

  const handleOpenDocument = useCallback(
    async (documentId: string) => {
      if (!loadView) return;
      setLoading(true);
      try {
        setDoc(null);
        const doc = await loadView(documentId, true);

        setDoc(doc);
        // eslint-disable-next-line
      } catch (e: any) {
        console.error(e);
        toast.error(e.message);
      } finally {
        setLoading(false);
      }
    },
    [loadView]
  );
  const handleCreateDocument = useCallback(
    async (documentId: string) => {
      if (!createOrphanedView || !documentId) return;
      setLoading(true);
      try {
        setDoc(null);
        await createOrphanedView({ document_id: documentId });

        await handleOpenDocument(documentId);
        // eslint-disable-next-line
      } catch (e: any) {
        toast.error(e.message);
      } finally {
        setLoading(false);
      }
    },
    [createOrphanedView, handleOpenDocument]
  );

  useEffect(() => {
    if (!documentId) return;

    void (async () => {
      try {
        await checkIfRowDocumentExists?.(documentId);
        void handleOpenDocument(documentId);
      } catch (e) {
        void handleCreateDocument(documentId);
      }
    })();
  }, [handleOpenDocument, documentId, handleCreateDocument, checkIfRowDocumentExists]);

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

        lastIsEmptyRef.current = isEmpty;

        if (shouldSkipIsDocumentEmptyUpdate(isEmpty)) {
          return;
        }

        updateRowMeta(RowMetaKey.IsDocumentEmpty, isEmpty);
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
  }, [doc, isDocumentEmpty, shouldSkipIsDocumentEmptyUpdate, updateRowMeta]);

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
