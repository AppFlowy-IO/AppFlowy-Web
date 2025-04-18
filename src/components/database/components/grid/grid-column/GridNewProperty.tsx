import { RenderRow, RenderRowType } from '@/components/database/components/grid/grid-row';
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';

function GridNewProperty ({ row }: {
  row: RenderRow
}) {
  const { t } = useTranslation();
  const type = row.type;

  if (type === RenderRowType.Header) {
    return <div className={'flex text-text-secondary px-3 py-2 cursor-pointer hover:bg-fill-content-hover bg-fill-content border-b border-border-primary h-[36px] flex-1 font-medium text-sm items-center gap-1.5'}>
      <PlusIcon className={'w-5 h-5'} />
      {t('grid.field.newProperty')}
    </div>;
  }

  return null;
}

export default GridNewProperty;