import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useDatabaseFields, useReadOnly } from '@/application/database-yjs';
import type { GridGroup } from '@/application/database-yjs';
import {
  useClearGroupByFieldDispatch,
  useNewRowDispatch,
  useSetListGroupVisibilityDispatch,
  useToggleListGroupCollapsedDispatch,
} from '@/application/database-yjs/dispatch';
import { ReactComponent as ArrowIcon } from '@/assets/icons/alt_arrow_right_small.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { ReactComponent as TickIcon } from '@/assets/icons/tick.svg';
import { Tag } from '@/components/_shared/tag';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import { getListGroupCellsData } from './ListRowActions';

function useCreateListGroupRow(groupFieldId?: string, groupId?: string, openAfterCreate = false) {
  const fields = useDatabaseFields();
  const createRow = useNewRowDispatch();

  return useCallback(async () => {
    await createRow({
      cellsData: getListGroupCellsData(fields, groupFieldId, groupId),
      openAfterCreate,
      tailing: true,
    });
  }, [createRow, fields, groupFieldId, groupId, openAfterCreate]);
}

export function ListGroupHeader({
  fieldId,
  fieldName,
  fieldType,
  group,
  groupConfigId,
}: {
  fieldId?: string;
  fieldName?: string;
  fieldType?: FieldType;
  group: GridGroup;
  groupConfigId?: string;
}) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const toggleCollapsed = useToggleListGroupCollapsedDispatch(groupConfigId);
  const setVisibility = useSetListGroupVisibilityDispatch(groupConfigId, fieldId);
  const clearGrouping = useClearGroupByFieldDispatch();
  const createRow = useCreateListGroupRow(fieldId, group.id);
  const isCheckbox = fieldType === FieldType.Checkbox;
  const isChecked = group.id === 'Yes';
  const optionBackgroundToken = group.option ? SelectOptionColorMap[group.option.color] : undefined;
  const optionTextToken = group.option ? SelectOptionFgColorMap[group.option.color] : undefined;

  return (
    <div
      className='group/list-group-header flex h-11 min-w-0 items-center gap-2 pl-10 pr-1 text-sm text-text-primary'
      data-group-id={group.id}
      data-testid={`list-group-header-${group.id}`}
    >
      <Button
        aria-expanded={!group.collapsed}
        aria-label={group.collapsed ? t('button.expand', 'Expand group') : t('button.collapse', 'Collapse group')}
        className='h-7 w-7 rounded-[4px] p-0.5'
        data-testid='list-group-collapse-toggle'
        onClick={() => toggleCollapsed(group.id, !group.collapsed)}
        size='icon'
        type='button'
        variant='ghost'
      >
        <ArrowIcon className={cn('h-5 w-5 text-icon-primary transition-transform', !group.collapsed && 'rotate-90')} />
      </Button>

      {group.option ? (
        <div
          className='min-w-0'
          data-background-color-token={optionBackgroundToken}
          data-testid='list-group-option-tag'
          data-text-color-token={optionTextToken}
        >
          <Tag bgColor={optionBackgroundToken} label={group.option.name} textColor={optionTextToken} />
        </div>
      ) : isCheckbox ? (
        <div className='flex min-w-0 items-center gap-1.5'>
          <span
            aria-checked={isChecked}
            aria-label={`${fieldName}: ${isChecked ? t('button.yes', 'Yes') : t('button.no', 'No')}`}
            aria-readonly='true'
            className={cn(
              'flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-[4px] border border-border-primary',
              isChecked && 'border-fill-theme-thick bg-fill-theme-thick text-text-on-fill'
            )}
            role='checkbox'
          >
            {isChecked ? <TickIcon aria-hidden='true' className='h-3.5 w-3.5' /> : null}
          </span>
          <span className='truncate'>{fieldName}</span>
        </div>
      ) : (
        <span className='max-w-[360px] truncate'>{group.label}</span>
      )}

      <span className='px-1 text-text-secondary' data-testid='list-group-row-count'>
        {group.rows.length}
      </span>

      {!readOnly ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t('button.more', 'Group actions')}
                className='h-7 w-7 rounded-[4px] p-1 opacity-0 focus-visible:opacity-100 group-focus-within/list-group-header:opacity-100 group-hover/list-group-header:opacity-100 data-[state=open]:opacity-100'
                data-testid='list-group-actions'
                size='icon'
                type='button'
                variant='ghost'
              >
                <MoreIcon className='h-4 w-4' />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align='start' className='min-w-[180px]'>
              <DropdownMenuItem data-testid='list-hide-group' onSelect={() => setVisibility(group.id, false)}>
                {t('board.hideGroup', 'Hide group')}
              </DropdownMenuItem>
              <DropdownMenuItem data-testid='list-remove-grouping' onSelect={clearGrouping} variant='destructive'>
                {t('board.removeGrouping', 'Remove grouping')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
          <Button
            aria-label={t('grid.row.newRow', 'New row in group')}
            className='h-7 w-7 rounded-[4px] p-1 opacity-0 focus-visible:opacity-100 group-focus-within/list-group-header:opacity-100 group-hover/list-group-header:opacity-100'
            data-testid='list-group-new-row'
            onClick={() => void createRow()}
            size='icon'
            type='button'
            variant='ghost'
          >
            <PlusIcon className='h-4 w-4' />
          </Button>
        </>
      ) : null}
    </div>
  );
}

export function ListGroupFooter({ fieldId, groupId }: { fieldId?: string; groupId: string }) {
  const { t } = useTranslation();
  const createRow = useCreateListGroupRow(fieldId, groupId);

  return (
    <div className='ml-10 h-9 border-b border-border-primary px-1' data-testid={`list-group-footer-${groupId}`}>
      <button
        className='flex h-9 w-full items-center gap-1.5 rounded-[6px] px-2 text-left text-sm text-text-tertiary hover:bg-fill-content-hover'
        onClick={() => void createRow()}
        type='button'
      >
        <PlusIcon className='h-4 w-4' />
        {t('grid.row.newRow')}
      </button>
    </div>
  );
}

export function ListGroupSeparator() {
  return <div aria-hidden className='h-3' />;
}
