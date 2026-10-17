import { useTranslation } from 'react-i18next';

import { FieldType } from '@/application/database-yjs';
import { useNewPropertyDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { useGridContext } from '@/components/database/grid/useGridContext';

function GridNewProperty() {
  const { t } = useTranslation();
  const onNewProperty = useNewPropertyDispatch();
  const { setActivePropertyId } = useGridContext();

  return (
    <button
      type='button'
      data-testid='grid-new-property-button'
      onClick={() => setActivePropertyId(onNewProperty(FieldType.RichText))}
      className='flex h-[36px] flex-1 cursor-pointer items-center gap-1.5 bg-fill-content px-3 py-2 text-sm font-medium text-text-secondary hover:bg-fill-content-hover'
    >
      <PlusIcon className='h-5 w-5' />
      {t('grid.field.newProperty')}
    </button>
  );
}

export default GridNewProperty;
