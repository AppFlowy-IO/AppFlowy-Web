import { useCallback, useEffect, useMemo, useState } from 'react';

import { useDatabaseContext, useFieldsSelector, usePrimaryFieldId, useReadOnly } from '@/application/database-yjs';
import type { Row } from '@/application/database-yjs';
import { useDatabaseSearch } from '@/components/database/components/conditions/DatabaseSearchContext';
import { cn } from '@/lib/utils';

import { FEED_DESKTOP_INLINE_PADDING, FEED_INITIAL_ROW_LIMIT, FEED_LOAD_MORE_INCREMENT } from './feed.constants';
import { FeedCard } from './FeedCard';
import { FeedEmptyState, FeedLoadingIndicator, FeedLoadMore, FeedNewRow } from './FeedControls';
import { FeedMembersProvider } from './FeedMembersContext';
import { useFeedRowData } from './useFeedRowOrders';
import { useFeedSearch } from './useFeedSearch';

/**
 * Feed layout (Desktop `DesktopFeedPage`): a vertical list of row cards,
 * newest first, with incremental rendering and a trailing "new page" action.
 */
export function Feed() {
  const primaryFieldId = usePrimaryFieldId();
  const fields = useFieldsSelector();
  const readOnly = useReadOnly();
  const { query } = useDatabaseSearch();
  const { rowOrders, cachedRowDocs } = useFeedRowData(Boolean(query.trim()));
  const matchingRows = useFeedSearch({ rows: rowOrders, fields, primaryFieldId, cachedRowDocs, query });
  const { activeViewId, isDocumentBlock, onRendered, paddingEnd, paddingStart } = useDatabaseContext();
  const paginationScope = JSON.stringify([activeViewId, isDocumentBlock, query]);
  const [pagination, setPagination] = useState({ scope: paginationScope, limit: FEED_INITIAL_ROW_LIMIT });

  // Reset before children commit so a new query never inherits a previously
  // expanded result window and briefly mounts its covers/composers.
  if (pagination.scope !== paginationScope) {
    setPagination({ scope: paginationScope, limit: FEED_INITIAL_ROW_LIMIT });
  }

  const visibleRowLimit = pagination.scope === paginationScope ? pagination.limit : FEED_INITIAL_ROW_LIMIT;

  useEffect(() => {
    if (rowOrders !== undefined) onRendered?.();
  }, [onRendered, rowOrders]);

  const visibleRows = useMemo(() => matchingRows?.slice(0, visibleRowLimit), [matchingRows, visibleRowLimit]);
  const remainingRowCount = Math.max((matchingRows?.length ?? 0) - visibleRowLimit, 0);
  const loadMoreRows = useCallback(() => {
    setPagination((current) => ({ ...current, limit: current.limit + FEED_LOAD_MORE_INCREMENT }));
  }, []);

  const containerClassName = cn(
    'database-feed appflowy-custom-scroller min-h-0 w-full',
    isDocumentBlock ? 'overflow-visible' : 'h-full flex-1 overflow-y-auto overflow-x-hidden'
  );
  const contentStyle = {
    paddingInlineEnd: paddingEnd ?? FEED_DESKTOP_INLINE_PADDING,
    paddingInlineStart: paddingStart ?? FEED_DESKTOP_INLINE_PADDING,
  };

  if (rowOrders === undefined || !primaryFieldId) {
    return (
      <div className={containerClassName} data-testid='database-feed'>
        <FeedLoadingIndicator fillAvailable={!isDocumentBlock} />
      </div>
    );
  }

  if (rowOrders.length === 0) {
    return (
      <div className={containerClassName} data-testid='database-feed'>
        <FeedEmptyState />
      </div>
    );
  }

  return (
    <div className={containerClassName} data-testid='database-feed'>
      <FeedMembersProvider>
        <div className='w-full py-2' data-testid='feed-list' style={contentStyle}>
          <FeedCards
            fields={fields}
            key={`${activeViewId}:${isDocumentBlock}`}
            primaryFieldId={primaryFieldId}
            rows={rowOrders}
            visibleRows={visibleRows ?? []}
          />

          {remainingRowCount > 0 ? <FeedLoadMore onLoadMore={loadMoreRows} remainingCount={remainingRowCount} /> : null}
          {!readOnly ? <FeedNewRow /> : null}
        </div>
      </FeedMembersProvider>
    </div>
  );
}

export default Feed;

/** Retain only cards with drafts/uploads when a search hides their result. */
function FeedCards({
  fields,
  primaryFieldId,
  rows,
  visibleRows,
}: {
  fields: React.ComponentProps<typeof FeedCard>['fields'];
  primaryFieldId: string;
  rows: Row[];
  visibleRows: Row[];
}) {
  const [draftIds, setDraftIds] = useState<ReadonlySet<string>>(() => new Set());
  const handleDraftChange = useCallback((rowId: string, hasDraft: boolean) => {
    setDraftIds((current) => {
      if (current.has(rowId) === hasDraft) return current;
      const next = new Set(current);

      if (hasDraft) next.add(rowId);
      else next.delete(rowId);
      return next;
    });
  }, []);
  const visibleIds = new Set(visibleRows.map(({ id }) => id));
  const mountedRows = rows.filter(({ id }) => visibleIds.has(id) || draftIds.has(id));

  return (
    <>
      {mountedRows.map(({ id }) => (
        <FeedCard
          fields={fields}
          hidden={!visibleIds.has(id)}
          key={id}
          onDraftChange={handleDraftChange}
          primaryFieldId={primaryFieldId}
          rowId={id}
        />
      ))}
    </>
  );
}
