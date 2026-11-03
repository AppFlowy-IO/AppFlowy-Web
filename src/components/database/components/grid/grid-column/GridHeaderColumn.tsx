import { useMemo, useState, type MouseEvent } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useFieldSelector, useReadOnly } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as AIIndicatorSvg } from '@/assets/icons/database/ai.svg';
import GridFieldMenu from '@/components/database/components/grid/grid-column/GridFieldMenu';
import GridNewProperty from '@/components/database/components/grid/grid-column/GridNewProperty';
import { GridColumnType, RenderColumn } from '@/components/database/components/grid/grid-column/useRenderFields';
import { useGridRowContext } from '@/components/database/components/grid/grid-row/GridRowContext';
import { useGridContext, useGridOptions } from '@/components/database/grid/useGridContext';
import { isFieldEditingDisabled } from '@/components/database/utils/field-editing';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { FieldDisplay } from 'src/components/database/components/field/FieldDisplay';

import { ResizeHandle } from './ResizeHandle';

const DASHBOARD_HEADER_ICON_CLASS = '!h-4 !w-4 shrink-0 text-dash-tool-icon';

export function GridHeaderColumn({
  column,
  onResizeColumnStart,
}: {
  column: RenderColumn;
  onResizeColumnStart?: (fieldId: string, element: HTMLElement) => void;
}) {
  const readOnly = useReadOnly();
  // A dashboard widget's grid draws its header glyphs as dashboard chrome:
  // 16px in the tool-icon colour, the same as desktop.
  const iconClassName = useGridOptions().headerIcons === 'dashboard' ? DASHBOARD_HEADER_ICON_CLASS : undefined;
  const fieldId = column.fieldId || '';
  const { t } = useTranslation();

  const { showStickyHeader } = useGridContext();
  const { isSticky } = useGridRowContext();
  const { field } = useFieldSelector(fieldId);
  const type = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const isAIField = [FieldType.Summary, FieldType.Translate].includes(type);
  const isEditingDisabled = isFieldEditingDisabled(type);
  const isNewProperty = column.type === GridColumnType.NewProperty;
  const [menuOpen, setMenuOpen] = useState(false);
  const name = field?.get(YjsDatabaseKey.name);
  const fieldName = typeof name === 'string' ? name : '';
  const tooltipContent = isEditingDisabled ? t('common.desktopOnly') : fieldName;
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
        <FieldDisplay
          fieldId={fieldId}
          showRelationDatabaseName
          className={'flex-1 justify-start gap-[10px] overflow-hidden text-left'}
          iconClassName={iconClassName}
        />
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
  }, [fieldId, iconClassName, isAIField, onResizeColumnStart, readOnly, tooltipContent]);

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
