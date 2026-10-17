import React from 'react';
import { useTranslation } from 'react-i18next';

import { FieldVisibility, useFieldsSelector } from '@/application/database-yjs';
import { useDatabaseVerification } from '@/application/page-verification/database';
import { ReactComponent as Checklist } from '@/assets/icons/database/checklist.svg';
import Property from '@/components/database/components/settings/Property';
import {
  PropertyDragContext,
  usePropertyDragContextValue,
} from '@/components/database/components/settings/usePropertyDragContext';
import { VerificationPropertyControl } from '@/components/page-verification/VerificationPropertyControl';
import {
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';

const allVisibilities = [FieldVisibility.AlwaysShown, FieldVisibility.HideWhenEmpty, FieldVisibility.AlwaysHidden];

function Properties({ excludeFieldId }: { excludeFieldId?: string }) {
  const { t } = useTranslation();
  const fields = useFieldsSelector(allVisibilities);
  const { fieldId: verificationFieldId } = useDatabaseVerification();
  const properties = React.useMemo(
    () => fields.filter((field) => field.fieldId !== excludeFieldId).map((field) => ({
      id: field.fieldId,
      visible: field.visibility !== FieldVisibility.AlwaysHidden,
    })),
    [fields, excludeFieldId]
  );

  const [container, setContainer] = React.useState<HTMLDivElement | null>(null);
  const contextValue = usePropertyDragContextValue(properties, container);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid='database-properties-settings-trigger'>
        <Checklist aria-hidden='true' />
        <span>{t('grid.settings.properties')}</span>
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
            {!verificationFieldId && <VerificationPropertyControl />}
          </PropertyDragContext.Provider>
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export default Properties;
