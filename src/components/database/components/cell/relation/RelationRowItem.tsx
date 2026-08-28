import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

function RelationRowItem ({ rowId, content, loading }: {
  rowId: string,
  content: string;
  /** The row exists, but its primary cell has not been fetched yet. */
  loading?: boolean;
}) {
  const { t } = useTranslation();

  return (
    <div
      data-row-id={rowId}
      aria-busy={loading || undefined}
      style={{
        scrollMarginTop: '80px',
      }}
      className={cn('flex-1 truncate text-sm text-text-primary', !loading && !content && 'text-text-secondary')}
    >
      {loading ? (
        // Falling through to the "Untitled" fallback below would be indistinguishable from a row
        // whose primary cell really is empty, so a title still in flight gets a placeholder bar.
        <>
          <span
            aria-hidden
            data-testid='relation-row-skeleton'
            className='block h-4 w-24 animate-pulse rounded bg-fill-content-hover'
          />
          <span className='sr-only'>{t('loading')}</span>
        </>
      ) : (
        content || t('menuAppHeader.defaultNewPageName')
      )}
    </div>
  );
}

export default RelationRowItem;
