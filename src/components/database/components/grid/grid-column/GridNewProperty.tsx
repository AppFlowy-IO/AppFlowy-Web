import { useTranslation } from 'react-i18next';

import { FieldType } from '@/application/database-yjs';
import { useNewPropertyDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { useGridContext } from '@/components/database/grid/useGridContext';

function GridNewProperty () {
  const { t } = useTranslation();
  const onNewProperty = useNewPropertyDispatch();
  const {
    setActivePropertyId,
  } = useGridContext();

  return <div
    data-testid="grid-new-property-button"
    onClick={() => {
      const id = onNewProperty(FieldType.RichText);

      setActivePropertyId(id);
    }}
    className={'flex text-text-secondary px-3 py-2 cursor-pointer hover:bg-fill-content-hover bg-fill-content h-[36px] flex-1 font-medium text-sm items-center gap-1.5'}
  >
    <PlusIcon className={'w-5 h-5'} />
    {t('grid.field.newProperty')}
  </div>;
}

export default GridNewProperty;