import { memo } from 'react';

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
 * This separation follows the single responsibility principle and avoids
 * if-else branches within the components.
 */
export const RowSubDocument = memo(({ rowId, contentPadding, onRegisterPendingMetaFlush }: RowSubDocumentProps) => {
  const readOnly = useReadOnly();

  if (readOnly) {
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
