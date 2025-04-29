import { usePropertiesSelector } from '@/application/database-yjs';
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
import React from 'react';
import { useTranslation } from 'react-i18next';
import { ReactComponent as Checklist } from '@/assets/icons/database/checklist.svg';

function Properties () {
  const { t } = useTranslation();
  const { properties } = usePropertiesSelector();

  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  const contextValue = usePropertyDragContextValue(properties, container);

  return (

    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <Checklist />
        {t('grid.settings.properties')}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>

        <DropdownMenuSubContent
          className={'max-h-[450px] appflowy-scroller overflow-y-auto'}
          ref={setContainer}
        >
          <PropertyDragContext.Provider value={contextValue}>
            {properties.map(property => (
              <Property
                key={property.id}
                property={property}
              />
            ))}
          </PropertyDragContext.Provider>
        </DropdownMenuSubContent>

      </DropdownMenuPortal>
    </DropdownMenuSub>

  );
}

export default Properties;