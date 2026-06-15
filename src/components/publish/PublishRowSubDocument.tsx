import { memo, useEffect, useMemo, useState } from 'react';

import { useDatabaseContextOptional } from '@/application/database-yjs';
import { metaIdFromRowId } from '@/application/database-yjs/const';
import { RowMetaKey } from '@/application/database-yjs/database.type';
import { YDoc, YjsEditorKey } from '@/application/types';
import { EditorSkeleton } from '@/components/_shared/skeleton/EditorSkeleton';
import { Editor } from '@/components/editor';

/**
 * PublishRowSubDocument - A simplified component for displaying row documents in publish mode.
 *
 * This component is used in read-only publish views where:
 * - Documents are loaded from IndexedDB cache (populated during publish view load)
 * - No sync, creation, or update logic is needed
 * - The document is displayed read-only
 *
 * For app mode (authenticated, editable), use DatabaseRowSubDocument instead.
 */
export const PublishRowSubDocument = memo(({ rowId }: { rowId: string }) => {
  const context = useDatabaseContextOptional();
  const loadRowDocument = context?.loadRowDocument;

  // Compute documentId directly from rowId using the same logic as getMetaJSON
  // This avoids dependency on useRowMetaSelector which requires rowMap to be populated
  const documentId = useMemo(() => {
    if (!rowId) return undefined;
    return metaIdFromRowId(rowId)(RowMetaKey.DocumentId);
  }, [rowId]);

  const [doc, setDoc] = useState<YDoc | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    // documentId is computed from rowId, so should always be available
    if (!documentId || !loadRowDocument) {
      setLoading(false);
      return;
    }

    let cancelled = false;

    setLoading(true);

    loadRowDocument(documentId)
      .then((loadedDoc) => {
        if (!cancelled && loadedDoc) {
          setDoc(loadedDoc);
        }
      })
      .catch(() => {
        // Failed to load, will show nothing
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [documentId, loadRowDocument]);

  if (loading) {
    return <EditorSkeleton />;
  }

  // Check if document has the expected structure
  const document = doc?.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.document);

  if (!doc || !documentId || !document || !context) {
    return null;
  }

  return (
    <Editor
      {...context}
      fullWidth
      workspaceId="publish"
      viewId={documentId}
      doc={doc}
      readOnly={true}
    />
  );
});

PublishRowSubDocument.displayName = 'PublishRowSubDocument';

export default PublishRowSubDocument;
