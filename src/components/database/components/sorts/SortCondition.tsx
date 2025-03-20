import { Sort } from '@/application/database-yjs';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as ArrowDownSvg } from '@/assets/icons/alt_arrow_left.svg';

function SortCondition({ sort }: { sort: Sort }) {
  const condition = sort.condition;
  const { t } = useTranslation();
  const conditionText = useMemo(() => {
    switch (condition) {
      case 0:
        return t('grid.sort.ascending');
      case 1:
        return t('grid.sort.descending');
    }
  }, [condition, t]);

  return (
    <div
      className={
        'flex w-[120px] max-w-[250px] items-center justify-between gap-1.5 rounded-full border border-line-divider py-1 px-2 font-medium '
      }
    >
      <span className={'text-xs'}>{conditionText}</span>
      <ArrowDownSvg className={'h-5 w-5 text-text-caption'} />
    </div>
  );
}

export default SortCondition;
