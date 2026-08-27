import { useTranslation } from 'react-i18next';

import { FieldType, useFieldSelector, useReadOnly } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as DragIcon } from '@/assets/icons/drag.svg';
import { ReactComponent as TemplateDragIcon } from '@/assets/icons/database-template/drag-element.svg';
import RowPropertyPrimitive from '@/components/database/components/database-row/RowPropertyPrimitive';
import DragItem from '@/components/database/components/drag-and-drop/DragItem';
import { isFieldEditingDisabled } from '@/components/database/utils/field-editing';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function RowProperty(props: {
  fieldId: string;
  rowId: string;
  isActive: boolean;
  setActivePropertyId: (id: string | null) => void;
  templateStyle?: boolean;
}) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();

  const { fieldId, setActivePropertyId } = props;
  const { field } = useFieldSelector(fieldId);
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const isEditingDisabled = isFieldEditingDisabled(fieldType);

  if (readOnly) {
    return <RowPropertyPrimitive {...props} />;
  }

  return (
    <DragItem
      dragHandleVisibility={'hover'}
      id={fieldId}
      className={props.templateStyle ? 'items-start pb-2 pr-0' : 'items-start pb-4 pr-5'}
      dragIcon={
        <Tooltip>
          <TooltipTrigger
            onClick={() => {
              if (readOnly || isEditingDisabled) return;
              setActivePropertyId(fieldId);
            }}
            className={props.templateStyle ? 'relative h-[30px] w-4' : 'relative top-2 h-full'}
          >
            {props.templateStyle ? (
              <TemplateDragIcon className='h-4 w-4 text-icon-secondary' />
            ) : (
              <DragIcon className='h-5 w-5 text-icon-secondary' />
            )}
          </TooltipTrigger>
          <TooltipContent>{t('tooltip.openMenu')}</TooltipContent>
        </Tooltip>
      }
    >
      <RowPropertyPrimitive {...props} />
    </DragItem>
  );
}

export default RowProperty;
