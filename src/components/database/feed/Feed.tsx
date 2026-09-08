import { useCallback, useEffect, useMemo, useState } from 'react';

import { useDatabaseContext, usePrimaryFieldId, useReadOnly } from '@/application/database-yjs';
import type { Row } from '@/application/database-yjs';
import { useDatabaseSearch } from '@/components/database/components/conditions/DatabaseSearchContext';
import { cn } from '@/lib/utils';

import { FEED_DESKTOP_INLINE_PADDING, FEED_INITIAL_ROW_LIMIT, FEED_LOAD_MORE_INCREMENT } from './feed.constants';
import { FeedCard } from './FeedCard';
import { FeedEmptyState, FeedLoadingIndicator, FeedLoadMore, FeedNewRow } from './FeedControls';
import { FeedMembersProvider } from './FeedMembersContext';
import { useFeedRowOrders } from './useFeedRowOrders';

/**
 * Feed layout (Desktop `DesktopFeedPage`): a vertical list of row cards,
 * newest first, with incremental rendering and a trailing "new page" action.
 */
export function Feed() {
  const rowOrders = useFeedRowOrders();
  const primaryFieldId = usePrimaryFieldId();
  const readOnly = useReadOnly();
  const { query } = useDatabaseSearch();
  const { activeViewId, isDocumentBlock, onRendered, paddingEnd, paddingStart } = useDatabaseContext();
  const [visibleRowLimit, setVisibleRowLimit] = useState(FEED_INITIAL_ROW_LIMIT);

  useEffect(() => {
    setVisibleRowLimit(FEED_INITIAL_ROW_LIMIT);
  }, [activeViewId, isDocumentBlock]);

  useEffect(() => {
    if (rowOrders !== undefined) onRendered?.();
  }, [onRendered, rowOrders]);

  const searchActive = query.trim().length > 0;
  const visibleRows = useMemo(
    () => (searchActive ? rowOrders : rowOrders?.slice(0, visibleRowLimit)),
    [rowOrders, searchActive, visibleRowLimit]
  );
  const remainingRowCount = rowOrders && !searchActive ? Math.max(rowOrders.length - visibleRowLimit, 0) : 0;
  const loadMoreRows = useCallback(() => {
    setVisibleRowLimit((current) => current + FEED_LOAD_MORE_INCREMENT);
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
          {visibleRows?.map((row: Row) => (
            <FeedCard key={row.id} primaryFieldId={primaryFieldId} rowId={row.id} />
          ))}

          {remainingRowCount > 0 ? <FeedLoadMore onLoadMore={loadMoreRows} remainingCount={remainingRowCount} /> : null}
          {!readOnly ? <FeedNewRow /> : null}
        </div>
      </FeedMembersProvider>
    </div>
  );
}

export default Feed;
