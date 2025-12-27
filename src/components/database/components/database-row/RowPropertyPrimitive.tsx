import { FieldType, useFieldSelector, useReadOnly } from '@/application/database-yjs';
import { Cell } from '@/application/database-yjs/cell.type';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as AIIndicatorSvg } from '@/assets/icons/database/ai.svg';
import RowPropertyCell from '@/components/database/components/database-row/RowPropertyCell';
import { FieldDisplay } from '@/components/database/components/field';
import PropertyMenu from '@/components/database/components/property/PropertyMenu';
import { isFieldEditingDisabled } from '@/components/database/utils/field-editing';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { useTranslation } from 'react-i18next';

function RowPropertyPrimitive({
  fieldId,
  rowId,
  isActive,
  setActivePropertyId,
  onCellUpdated,
  showPropertyName = true,
}: {
  fieldId: string;
  rowId: string;
  isActive: boolean;
  onCellUpdated?: (cell: Cell) => void;
  setActivePropertyId: (id: string | null) => void;
  showPropertyName?: boolean;
}) {
  const readOnly = useReadOnly();
  const { t } = useTranslation();
  const { field } = useFieldSelector(fieldId);
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const isAIField = [FieldType.AISummaries, FieldType.AITranslations].includes(fieldType);
  const fieldName = field?.get(YjsDatabaseKey.name) || '';
  const isEditingDisabled = isFieldEditingDisabled(fieldType);
  const fallbackFieldName =
    fieldType === FieldType.Relation
      ? t('grid.field.relationFieldName')
      : t('grid.field.rollupFieldName', { defaultValue: 'Rollup' });
  const tooltipContent =
    isEditingDisabled && (fieldType === FieldType.Relation || fieldType === FieldType.Rollup)
    ? t('tooltip.fieldEditingUnavailable', {
      field: fieldName.trim() ? fieldName.trim() : fallbackFieldName,
    })
    : fieldName;

  return (
    <div className={'flex min-h-[36px] w-full items-start gap-2'}>
      <PropertyMenu
        open={isActive}
        onOpenChange={(status) => {
          if (status && (readOnly || isEditingDisabled)) {
            return;
          }

          if (status) {
            setActivePropertyId(fieldId);
          } else {
            setActivePropertyId(null);
          }
        }}
        fieldId={fieldId}
      >
        <div
          className={cn(
            'property-label flex h-auto w-[30%] max-w-[240px] items-center gap-2 overflow-hidden rounded-300 px-1 py-2',
            !readOnly && 'cursor-pointer hover:bg-fill-content-hover',
            !showPropertyName && 'w-auto gap-0 p-2'
          )}
        >
          <Tooltip delayDuration={200} disableHoverableContent>
            <TooltipTrigger className={'overflow-hidden'}>
              <FieldDisplay
                showPropertyName={showPropertyName}
                fieldId={fieldId}
                className={'flex-1 gap-1.5 truncate text-sm text-text-primary'}
              />
            </TooltipTrigger>
            <TooltipContent side={'left'}>{tooltipContent}</TooltipContent>
          </Tooltip>
          {isAIField && <AIIndicatorSvg className={'h-5 w-5 min-w-5 text-text-featured'} />}
        </div>
      </PropertyMenu>
      <RowPropertyCell fieldId={fieldId} rowId={rowId} onCellUpdated={onCellUpdated} />
    </div>
  );
}

export default RowPropertyPrimitive;
