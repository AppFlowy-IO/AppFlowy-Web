import { FieldType, useFieldSelector, useReadOnly } from '@/application/database-yjs';
import { YjsDatabaseKey } from '@/application/types';
import GridFieldMenu from '@/components/database/components/grid/grid-column/GridFieldMenu';
import GridNewProperty from '@/components/database/components/grid/grid-column/GridNewProperty';
import { GridColumnType, RenderColumn } from '@/components/database/components/grid/grid-column/useRenderFields';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import React, { useMemo, useState } from 'react';
import { ReactComponent as AIIndicatorSvg } from '@/assets/icons/ai_indicator.svg';
import FieldDisplay from 'src/components/database/components/field/FieldDisplay';
import { ResizeHandle } from './ResizeHandle';

export function GridHeaderColumn ({ column, onResizeColumnStart }: {
  column: RenderColumn;
  onResizeColumnStart?: (fieldId: string, element: HTMLElement) => void;
}) {
  const readOnly = useReadOnly();
  const fieldId = column.fieldId || '';

  const { field } = useFieldSelector(fieldId);
  const type = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const isAIField = [FieldType.AISummaries, FieldType.AITranslations].includes(type);
  const isNewProperty = column.type === GridColumnType.NewProperty;
  const [menuOpen, setMenuOpen] = useState(false);
  const name = field?.get(YjsDatabaseKey.name);
  const children = useMemo(() => {

    return (
      <div
        style={{
          cursor: readOnly ? 'default' : 'pointer',
        }}
        className={'rounded-none text-text-secondary overflow-hidden hover:bg-fill-content-hover relative text-sm flex items-center px-2 h-full gap-[10px] w-full justify-start'}
      >
        <Tooltip delayDuration={500}>
          <TooltipTrigger
            onClick={e => {
              if (readOnly) return;
              e.stopPropagation();
              setMenuOpen(true);
            }}
            className={'flex-1 overflow-hidden'}
          >
            <FieldDisplay
              fieldId={fieldId}
              className={'gap-[10px] w-full text-left justify-start overflow-hidden'}
            />
          </TooltipTrigger>
          <TooltipContent side={'right'}>
            {name}
          </TooltipContent>
        </Tooltip>

        {isAIField && <AIIndicatorSvg className={'h-5 w-5 text-xl'} />}
        {onResizeColumnStart && !readOnly && fieldId && <ResizeHandle
          fieldId={fieldId}
          onResizeStart={onResizeColumnStart}
        />}

      </div>
    );
  }, [fieldId, name, isAIField, onResizeColumnStart, readOnly]);

  if (isNewProperty) {
    return (
      <GridNewProperty />
    );
  }

  if (readOnly) return children;

  return (
    <GridFieldMenu
      menuOpen={menuOpen}
      setMenuOpen={setMenuOpen}
      fieldId={fieldId}
    >
      {children}
    </GridFieldMenu>
  );
}

export default GridHeaderColumn;