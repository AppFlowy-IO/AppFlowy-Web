import { useTranslation } from 'react-i18next';

import { useNewRowDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';

function GridNewRow() {
  const { t } = useTranslation();
  const onNewRow = useNewRowDispatch();

  return (
    <div
      data-testid="grid-new-row"
      onClick={() => {
        void onNewRow({ tailing: true });
      }}
      className={
        'flex h-[36px] flex-1 cursor-pointer items-center gap-1.5 border-b border-t border-border-primary bg-fill-content px-3 py-2 text-sm font-medium text-text-secondary hover:bg-fill-content-hover'
      }
    >
      <PlusIcon className={'h-5 w-5'} />
      {t('grid.row.newRow')}
    </div>
  );
}

export default GridNewRow;
