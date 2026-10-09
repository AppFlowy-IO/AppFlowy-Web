import { Suspense, useCallback, useRef } from 'react';

import { useReadOnly } from '@/application/database-yjs';
import { AppendBreadcrumb } from '@/application/types';
import EditorSkeleton from '@/components/_shared/skeleton/EditorSkeleton';
import TableSkeleton from '@/components/_shared/skeleton/TableSkeleton';
import { usePreloadRichTextCellEditor } from '@/components/database/components/cell/text/rich-text/load';
import { DatabaseRowProperties, RowSubDocument } from '@/components/database/components/database-row';
import { RowCommentList } from '@/components/database/components/database-row/comment';
import DatabaseRowHeader from '@/components/database/components/header/DatabaseRowHeader';
import { DatabaseHistoryScope } from '@/components/database/DatabaseHistoryScope';
import { FeedMembersProvider } from '@/components/database/feed/FeedMembersContext';
import { FeedRowReactions } from '@/components/database/feed/FeedRowReactions';
import { useRowPeekNavigationGuard } from '@/components/database/row-peek/RowPeekNavigation';
import { cn } from '@/lib/utils';

import { Separator } from '../ui/separator';

import type { CSSProperties } from 'react';

export function DatabaseRow({
  appendBreadcrumb,
  rowId,
  compact = false,
}: {
  rowId: string;
  appendBreadcrumb?: AppendBreadcrumb;
  compact?: boolean;
}) {
  const readOnly = useReadOnly();
  const flushDocumentMeta = useRef<(() => void) | null>(null);
  const registerMetaFlush = useCallback((flush: (() => void) | null) => {
    flushDocumentMeta.current = flush;
  }, []);

  useRowPeekNavigationGuard(() => {
    flushDocumentMeta.current?.();
    return true;
  });

  // The title and Text properties are editable at once; this warms their
  // menus (toolbar, mentions, links).
  usePreloadRichTextCellEditor(!readOnly);

  return (
    <DatabaseHistoryScope
      className={'flex w-full justify-center'}
      rowId={rowId}
      style={{ '--row-page-inset': compact ? '44px' : undefined } as CSSProperties}
    >
      <div className={cn('relative flex w-[952px] min-w-0 max-w-full flex-col gap-4')}>
        <DatabaseRowHeader appendBreadcrumb={appendBreadcrumb} rowId={rowId} />

        <div className={'row-page-body flex w-full flex-1 flex-col gap-4'}>
          <Suspense fallback={<TableSkeleton columns={2} rows={4} />}>
            <DatabaseRowProperties rowId={rowId} />
          </Suspense>
          <div className={'row-properties-divider px-[var(--row-page-inset,96px)] max-sm:px-6'}>
            <Separator />
          </div>

          <Suspense
            fallback={<div className={'px-24 py-4 text-center text-sm text-text-tertiary max-sm:px-6'}>...</div>}
          >
            <div className={'row-comments px-[var(--row-page-inset,96px)] max-sm:px-6'}>
              <FeedMembersProvider>
                <FeedRowReactions rowId={rowId} testIdPrefix='detail' showAddReaction={false} />
              </FeedMembersProvider>
              <RowCommentList rowId={rowId} />
            </div>
          </Suspense>

          <div className={'row-document-divider px-[var(--row-page-inset,96px)] max-sm:px-6'}>
            <Separator />
          </div>

          <Suspense fallback={<EditorSkeleton />}>
            <div className={'min-h-[300px]'}>
              <RowSubDocument rowId={rowId} onRegisterPendingMetaFlush={registerMetaFlush} />
            </div>
          </Suspense>
        </div>
      </div>
    </DatabaseHistoryScope>
  );
}

export default DatabaseRow;
