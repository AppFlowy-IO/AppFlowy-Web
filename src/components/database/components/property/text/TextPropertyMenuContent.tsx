import { useFieldSelector } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import PropertySelectTrigger from '@/components/database/components/property/PropertySelectTrigger';

import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import React from 'react';
import { useTranslation } from 'react-i18next';

function TextPropertyMenuContent ({ fieldId }: {
  fieldId: string
}) {
  const { field } = useFieldSelector(fieldId);
  const isPrimary = field?.get(YjsDatabaseKey.is_primary);
  const { t } = useTranslation();

  if (isPrimary) {
    return <Tooltip disableHoverableContent>
      <TooltipTrigger asChild>
        <div className={''}>
          <PropertySelectTrigger
            fieldId={fieldId}
            disabled
          />
        </div>
      </TooltipTrigger>
      <TooltipContent side={'bottom'}>
        {t('grid.field.switchPrimaryFieldTooltip')}
      </TooltipContent>
    </Tooltip>;
  }

  return <PropertySelectTrigger fieldId={fieldId} />;
}

export default TextPropertyMenuContent;