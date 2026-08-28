import { useTranslation } from 'react-i18next';

import { FieldType } from '@/application/database-yjs';
import { useNewPropertyDispatch } from '@/application/database-yjs/dispatch';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';

function RowNewProperty({ setActivePropertyId }: { setActivePropertyId: (id: string) => void }) {
  const { t } = useTranslation();
  const onNewProperty = useNewPropertyDispatch();

  return (
    <button
      type='button'
      onClick={() => {
        const id = onNewProperty(FieldType.RichText);

        setActivePropertyId(id);
      }}
      className='mx-6 flex h-[36px] cursor-pointer items-center gap-1.5 rounded-300 bg-fill-content px-1 py-2 text-sm font-medium text-text-secondary hover:bg-fill-content-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-text-action'
    >
      <PlusIcon className={'h-5 w-5'} />
      {t('grid.field.newProperty')}
    </button>
  );
}

export default RowNewProperty;
