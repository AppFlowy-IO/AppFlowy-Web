import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

function RelationRowItem ({ rowId, content }: {
  rowId: string,
  content: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      data-row-id={rowId}
      style={{
        scrollMarginTop: '80px',
      }}
      className={cn('flex-1 truncate text-sm text-text-primary', !content && 'text-text-secondary')}
    >
      {content || t('menuAppHeader.defaultNewPageName')}
    </div>
  );
}

export default RelationRowItem;