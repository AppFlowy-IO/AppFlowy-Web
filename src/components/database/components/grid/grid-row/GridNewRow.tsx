import React from 'react';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { useTranslation } from 'react-i18next';

function GridNewRow () {
  const { t } = useTranslation();

  return (
    <div className={'flex px-3 py-2 cursor-pointer hover:bg-fill-content-hover bg-fill-content border-b border-border-primary h-[36px] flex-1 font-medium text-sm items-center gap-1.5 text-text-secondary'}>
      <PlusIcon className={'w-5 h-5'} />
      {t('grid.row.newRow')}
    </div>
  );
}

export default GridNewRow;