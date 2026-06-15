import { memo } from 'react';

import { useReadOnly } from '@/application/database-yjs';
import { DatabaseRowSubDocument } from './DatabaseRowSubDocument';
import { PublishRowSubDocument } from '@/components/publish/PublishRowSubDocument';

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
export const RowSubDocument = memo(({ rowId }: { rowId: string }) => {
  const readOnly = useReadOnly();

  if (readOnly) {
    return <PublishRowSubDocument rowId={rowId} />;
  }

  return <DatabaseRowSubDocument rowId={rowId} />;
});

RowSubDocument.displayName = 'RowSubDocument';

export default RowSubDocument;
