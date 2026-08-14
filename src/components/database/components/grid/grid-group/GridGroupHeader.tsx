import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useReadOnly } from '@/application/database-yjs';
import {
  useClearGroupByFieldDispatch,
  useSetGridGroupVisibilityDispatch,
  useToggleGridGroupCollapsedDispatch,
} from '@/application/database-yjs/dispatch';
import { ReactComponent as ArrowIcon } from '@/assets/icons/alt_arrow_right_small.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { ReactComponent as TickIcon } from '@/assets/icons/tick.svg';
import { Tag } from '@/components/_shared/tag';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';
import type { RenderRow } from '@/components/database/components/grid/grid-row';
import { useCreateGridGroupRow } from '@/components/database/components/grid/grid-row/GridNewRow';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

function GridGroupHeader({ data }: { data: RenderRow }) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const toggleCollapsed = useToggleGridGroupCollapsedDispatch(data.groupConfigId);
  const setVisibility = useSetGridGroupVisibilityDispatch(data.groupConfigId, data.groupFieldId);
  const clearGrouping = useClearGroupByFieldDispatch();
  const createRow = useCreateGridGroupRow(data.groupFieldId, data.groupId);
  const isCheckbox = data.groupFieldType === FieldType.Checkbox;
  const isChecked = data.groupId === 'Yes';
  const optionBackgroundToken = data.groupOption ? SelectOptionColorMap[data.groupOption.color] : undefined;
  const optionTextToken = data.groupOption ? SelectOptionFgColorMap[data.groupOption.color] : undefined;
  const onToggle = useCallback(() => {
    if (!data.groupId) return;
    toggleCollapsed(data.groupId, !data.groupCollapsed);
  }, [data.groupCollapsed, data.groupId, toggleCollapsed]);

  return (
    <div
      className='group/grid-group-header flex h-11 min-w-full items-center gap-2 bg-fill-content px-2 text-sm text-text-primary'
      data-group-id={data.groupId}
      data-testid={`grid-group-header-${data.groupId}`}
    >
      <button
        aria-expanded={!data.groupCollapsed}
        aria-label={data.groupCollapsed ? t('button.expand', 'Expand group') : t('button.collapse', 'Collapse group')}
        className='flex h-7 w-7 shrink-0 items-center justify-center rounded-300 hover:bg-fill-content-hover'
        data-testid='grid-group-collapse-toggle'
        onClick={onToggle}
        type='button'
      >
        <ArrowIcon
          className={cn('h-4 w-4 text-icon-primary transition-transform', !data.groupCollapsed && 'rotate-90')}
        />
      </button>

      {data.groupOption ? (
        <div
          className='min-w-0'
          data-background-color-token={optionBackgroundToken}
          data-testid='grid-group-option-tag'
          data-text-color-token={optionTextToken}
        >
          <Tag bgColor={optionBackgroundToken} label={data.groupOption.name} textColor={optionTextToken} />
        </div>
      ) : isCheckbox ? (
        <div className='flex min-w-0 items-center gap-1.5'>
          <span
            aria-label={`${data.groupFieldName}: ${isChecked ? t('button.yes', 'Yes') : t('button.no', 'No')}`}
            aria-checked={isChecked}
            aria-readonly='true'
            className={cn(
              'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-100 border border-border-primary',
              isChecked && 'border-fill-theme-thick bg-fill-theme-thick text-text-on-fill'
            )}
            role='checkbox'
            tabIndex={-1}
          >
            {isChecked && <TickIcon aria-hidden='true' className='h-3.5 w-3.5' />}
          </span>
          <span className='truncate'>{data.groupFieldName}</span>
        </div>
      ) : (
        <span className='max-w-[360px] truncate'>{data.groupLabel}</span>
      )}

      <span className='px-1 text-text-secondary' data-testid='grid-group-row-count'>
        {data.groupRowCount ?? 0}
      </span>

      {!readOnly && (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <button
                aria-label={t('button.more', 'Group actions')}
                className='flex h-7 w-7 items-center justify-center rounded-300 opacity-0 hover:bg-fill-content-hover focus-visible:opacity-100 group-focus-within/grid-group-header:opacity-100 group-hover/grid-group-header:opacity-100 data-[state=open]:opacity-100'
                data-testid='grid-group-actions'
                type='button'
              >
                <MoreIcon className='h-4 w-4' />
              </button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' className='min-w-[180px]'>
              <DropdownMenuItem
                data-testid='grid-hide-group'
                onSelect={() => data.groupId && setVisibility(data.groupId, false)}
              >
                {t('board.hideGroup', 'Hide group')}
              </DropdownMenuItem>
              <DropdownMenuItem data-testid='grid-remove-grouping' onSelect={clearGrouping} variant='destructive'>
                {t('board.removeGrouping', 'Remove grouping')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <button
            aria-label={t('grid.row.newRow', 'New row in group')}
            className='flex h-7 w-7 items-center justify-center rounded-300 opacity-0 hover:bg-fill-content-hover focus-visible:opacity-100 group-focus-within/grid-group-header:opacity-100 group-hover/grid-group-header:opacity-100'
            data-testid='grid-group-new-row'
            onClick={() => void createRow()}
            type='button'
          >
            <PlusIcon className='h-4 w-4' />
          </button>
        </>
      )}
    </div>
  );
}

export default GridGroupHeader;
