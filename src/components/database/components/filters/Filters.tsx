import { useFiltersSelector, useReadOnly } from '@/application/database-yjs';
import { useAddFilter } from '@/application/database-yjs/dispatch';
import PropertiesMenu from '@/components/database/components/conditions/PropertiesMenu';
import Filter from '@/components/database/components/filters/Filter';
import { Button } from '@/components/ui/button';
import React, { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as AddFilterSvg } from '@/assets/icons/plus.svg';

export function Filters () {
  const filters = useFiltersSelector();
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const [openPropertiesMenu, setOpenPropertiesMenu] = useState(false);

  const addFilter = useAddFilter();

  return (
    <>
      <div className={'flex items-center gap-1'}>
        {filters.map((filter) => (
          <Filter
            filterId={filter.id}
            key={filter.id}
          />
        ))}
      </div>

      {readOnly ? null : <PropertiesMenu
        searchPlaceholder={t('grid.settings.sortBy')}
        onSelect={fieldId => {
          addFilter(fieldId);
        }}
        open={openPropertiesMenu}
        onOpenChange={setOpenPropertiesMenu}
      >
        <Button
          variant="ghost"
          className={'mx-1 whitespace-nowrap'}
          size="sm"
        >
          <AddFilterSvg className={'w-5 h-5'} />
          {t('grid.settings.addFilter')}
        </Button>
      </PropertiesMenu>}

    </>
  );
}

export default Filters;
