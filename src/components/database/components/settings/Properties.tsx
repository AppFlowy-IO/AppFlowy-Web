import React from 'react';
import { useTranslation } from 'react-i18next';

import { usePropertiesSelector } from '@/application/database-yjs';
import { ReactComponent as Checklist } from '@/assets/icons/database/checklist.svg';
import { ReactComponent as ShowIcon } from '@/assets/icons/show.svg';
import Property from '@/components/database/components/settings/Property';
import {
  PropertyDragContext,
  usePropertyDragContextValue,
} from '@/components/database/components/settings/usePropertyDragContext';
import {
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

function Properties({ excludeFieldId, gallery = false }: { excludeFieldId?: string; gallery?: boolean }) {
  const { t } = useTranslation();
  const { properties: allProperties } = usePropertiesSelector();
  const properties = React.useMemo(
    () => allProperties.filter((property) => property.id !== excludeFieldId),
    [allProperties, excludeFieldId]
  );

  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  const contextValue = usePropertyDragContextValue(properties, container);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid='database-properties-settings-trigger'>
        {gallery ? <ShowIcon aria-hidden='true' /> : <Checklist aria-hidden='true' />}
        <span>{gallery ? t('grid.settings.propertyVisibility', 'Property visibility') : t('grid.settings.properties')}</span>
        <span className='ml-auto text-xs text-text-tertiary'>{properties.length}</span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent
          className={'appflowy-scroller max-h-[450px] max-w-[240px] overflow-y-auto'}
          ref={setContainer}
        >
          <PropertyDragContext.Provider value={contextValue}>
            {properties.map((property) => (
              <Property key={property.id} property={property} />
            ))}
          </PropertyDragContext.Provider>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export default Properties;
