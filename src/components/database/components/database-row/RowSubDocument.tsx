import { memo, useState } from 'react';

import { useReadOnly } from '@/application/database-yjs';
import { PublishRowSubDocument } from '@/components/publish/PublishRowSubDocument';

import { DatabaseRowSubDocument } from './DatabaseRowSubDocument';

import type { EditorContentPadding } from '@/components/editor/EditorContext';
import type { RegisterPendingRowDocumentMetaFlush } from './DatabaseRowSubDocument';

interface RowSubDocumentProps {
  rowId: string;
  contentPadding?: EditorContentPadding;
  onRegisterPendingMetaFlush?: RegisterPendingRowDocumentMetaFlush;
}

/**
 * RowSubDocument - A wrapper component that renders the appropriate
 * row sub-document component based on the current mode.
 *
 * - Publish mode (readOnly=true): Uses PublishRowSubDocument (simple, cache-based)
 * - App mode (readOnly=false): Uses DatabaseRowSubDocument (full sync, create, update)
 *
 * Once the editable document is mounted for a row, it stays mounted if access
 * becomes read-only. A permission notification clears the page's capabilities
 * until the server answers, so access can drop and return within a second.
 * Swapping renderers for that window remounted the document: its editor was
 * replaced by a skeleton and the row page scrolled to the top. The editable
 * renderer already follows `readOnly` in place, including a lasting downgrade.
 */
export const RowSubDocument = memo(({ rowId, contentPadding, onRegisterPendingMetaFlush }: RowSubDocumentProps) => {
  const readOnly = useReadOnly();
  const [editableRowId, setEditableRowId] = useState<string | null>(readOnly ? null : rowId);

  if (!readOnly && editableRowId !== rowId) {
    setEditableRowId(rowId);
  }

  if (readOnly && editableRowId !== rowId) {
    return <PublishRowSubDocument rowId={rowId} contentPadding={contentPadding} />;
  }

  return (
    <DatabaseRowSubDocument
      rowId={rowId}
      contentPadding={contentPadding}
      onRegisterPendingMetaFlush={onRegisterPendingMetaFlush}
    />
  );
});

RowSubDocument.displayName = 'RowSubDocument';

export default RowSubDocument;
