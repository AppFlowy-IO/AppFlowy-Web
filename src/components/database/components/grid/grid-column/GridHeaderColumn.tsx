import { useMemo, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useFieldSelector, useReadOnly } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as AIIndicatorSvg } from '@/assets/icons/database/ai.svg';
import GridFieldMenu from '@/components/database/components/grid/grid-column/GridFieldMenu';
import GridNewProperty from '@/components/database/components/grid/grid-column/GridNewProperty';
import { GridColumnType, RenderColumn } from '@/components/database/components/grid/grid-column/useRenderFields';
import { useGridRowContext } from '@/components/database/components/grid/grid-row/GridRowContext';
import { useGridContext } from '@/components/database/grid/useGridContext';
import { isFieldEditingDisabled } from '@/components/database/utils/field-editing';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import FieldDisplay from 'src/components/database/components/field/FieldDisplay';

import { ResizeHandle } from './ResizeHandle';

export function GridHeaderColumn({
  column,
  onResizeColumnStart,
}: {
  column: RenderColumn;
  onResizeColumnStart?: (fieldId: string, element: HTMLElement) => void;
}) {
  const readOnly = useReadOnly();
  const fieldId = column.fieldId || '';
  const { t } = useTranslation();

  const { showStickyHeader } = useGridContext();
  const { isSticky } = useGridRowContext();
  const { field } = useFieldSelector(fieldId);
  const type = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const isAIField = [FieldType.AISummaries, FieldType.AITranslations].includes(type);
  const isEditingDisabled = isFieldEditingDisabled(type);
  const isNewProperty = column.type === GridColumnType.NewProperty;
  const [menuOpen, setMenuOpen] = useState(false);
  const name = field?.get(YjsDatabaseKey.name);
  const fieldName = typeof name === 'string' ? name : '';
  const fallbackFieldName =
    type === FieldType.Relation
      ? t('grid.field.relationFieldName')
      : t('grid.field.rollupFieldName', { defaultValue: 'Rollup' });
  const tooltipContent =
    isEditingDisabled && (type === FieldType.Relation || type === FieldType.Rollup)
      ? t('tooltip.fieldEditingUnavailable', {
          field: fieldName.trim() ? fieldName.trim() : fallbackFieldName,
        })
      : fieldName;
  const children = useMemo(() => {
    const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
      if (readOnly) return;
      e.stopPropagation();
      setMenuOpen(true);
    };

    const triggerProps = {
      'data-testid': `grid-field-header-${fieldId}`,
      onClick: handleClick,
      className: 'flex h-full flex-1 items-center overflow-hidden focus-visible:outline-none',
    };
    const triggerContent = (
      <>
        <FieldDisplay fieldId={fieldId} className={'flex-1 justify-start gap-[10px] overflow-hidden text-left'} />
        {isAIField && <AIIndicatorSvg className={'h-5 w-5 text-text-featured'} />}
      </>
    );

    return (
      <div
        style={{
          cursor: readOnly ? 'default' : 'pointer',
        }}
        className={
          'relative flex h-full w-full items-center justify-start gap-[10px] rounded-none px-2 text-sm text-text-secondary hover:bg-fill-content-hover'
        }
      >
        <Tooltip disableHoverableContent delayDuration={500}>
          <TooltipTrigger {...triggerProps}>{triggerContent}</TooltipTrigger>
          <TooltipContent side={'right'}>{tooltipContent}</TooltipContent>
        </Tooltip>

        {onResizeColumnStart && !readOnly && fieldId && (
          <ResizeHandle fieldId={fieldId} onResizeStart={onResizeColumnStart} />
        )}
      </div>
    );
  }, [
    fieldId,
    isAIField,
    onResizeColumnStart,
    readOnly,
    tooltipContent,
  ]);

  const displayMenu = useMemo(() => {
    if (!showStickyHeader && isSticky) return false;
    if (showStickyHeader && !isSticky) return false;
    return true;
  }, [showStickyHeader, isSticky]);

  if (isNewProperty) {
    return <GridNewProperty />;
  }

  if (readOnly || !displayMenu) return children;

  return (
    <GridFieldMenu menuOpen={menuOpen} setMenuOpen={setMenuOpen} fieldId={fieldId}>
      {children}
    </GridFieldMenu>
  );
}

export default GridHeaderColumn;
