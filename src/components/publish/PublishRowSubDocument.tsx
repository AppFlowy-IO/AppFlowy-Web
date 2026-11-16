import { memo, useEffect, useMemo, useState } from 'react';

import { useDatabaseContextOptional } from '@/application/database-yjs';
import { metaIdFromRowId } from '@/application/database-yjs/const';
import { RowMetaKey } from '@/application/database-yjs/database.type';
import { LoadRowDocument, YDoc, YjsEditorKey } from '@/application/types';
import { EditorSkeleton } from '@/components/_shared/skeleton/EditorSkeleton';
import { Editor } from '@/components/editor';
import type { EditorContentPadding } from '@/components/editor/EditorContext';

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
interface PublishRowSubDocumentProps {
  rowId: string;
  contentPadding?: EditorContentPadding;
}

export const PublishRowSubDocument = memo(({ rowId, contentPadding }: PublishRowSubDocumentProps) => {
  const context = useDatabaseContextOptional();
  const loadRowDocument = context?.loadRowDocument;

  // Compute documentId directly from rowId using the same logic as getMetaJSON
  // This avoids dependency on useRowMetaSelector which requires rowMap to be populated
  const documentId = useMemo(() => {
    if (!rowId) return undefined;
    return metaIdFromRowId(rowId)(RowMetaKey.DocumentId);
  }, [rowId]);

  // Results belong to both the row identity and the snapshot loader. A route-only row
  // change must never pair the previous document with the new row's metadata, even
  // during the render before effect cleanup or when the new row has no document.
  const [loaded, setLoaded] = useState<{
    documentId: string;
    loader: LoadRowDocument;
    doc: YDoc | null;
  }>();

  useEffect(() => {
    setLoaded(undefined);
    if (!documentId || !loadRowDocument) return;

    let cancelled = false;
    const settle = (doc: YDoc | null) => {
      if (!cancelled) setLoaded({ documentId, loader: loadRowDocument, doc });
    };

    void loadRowDocument(documentId)
      .then(settle)
      .catch(() => settle(null));

    return () => {
      cancelled = true;
    };
  }, [documentId, loadRowDocument]);

  if (!documentId || !loadRowDocument) return null;
  if (loaded?.documentId !== documentId || loaded.loader !== loadRowDocument) {
    return <EditorSkeleton />;
  }

  // Check if document has the expected structure
  const doc = loaded.doc;
  const document = doc?.getMap(YjsEditorKey.data_section)?.get(YjsEditorKey.document);

  if (!doc || !documentId || !document || !context) {
    return null;
  }

  return (
    <Editor
      {...context}
      fullWidth
      contentPadding={contentPadding}
      workspaceId='publish'
      viewId={documentId}
      doc={doc}
      readOnly={true}
    />
  );
});

PublishRowSubDocument.displayName = 'PublishRowSubDocument';

export default PublishRowSubDocument;
