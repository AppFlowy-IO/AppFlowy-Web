import { useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useDatabaseFields, useDatabaseView, useReadOnly } from '@/application/database-yjs';
import type { GridGroup } from '@/application/database-yjs';
import {
  useClearGroupByFieldDispatch,
  useNewRowDispatch,
  useSetListGroupVisibilityDispatch,
  useToggleListGroupCollapsedDispatch,
} from '@/application/database-yjs/dispatch';
import { ReactComponent as ArrowDownFilledIcon } from '@/assets/icons/arrow_down_filled.svg';
import { ReactComponent as ArrowRightFilledIcon } from '@/assets/icons/arrow_right_filled.svg';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as HideIcon } from '@/assets/icons/hide.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { ReactComponent as TickIcon } from '@/assets/icons/tick.svg';
import { Tag } from '@/components/_shared/tag';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';
import { RowCreationSpinner, useRowCreationAction } from '@/components/database/hooks/useRowCreationAction';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { getListGroupCellsData } from './ListRowActions';

// Desktop GroupHeader: a 24px ghost button (2px padding) around a 20px filled arrow.
const collapsedIcon = (
  <ArrowRightFilledIcon
    aria-hidden='true'
    className='h-5 w-5 text-icon-primary'
    data-collapsed='true'
    data-testid='list-group-collapse-icon'
  />
);
const expandedIcon = (
  <ArrowDownFilledIcon
    aria-hidden='true'
    className='h-5 w-5 text-icon-primary'
    data-collapsed='false'
    data-testid='list-group-collapse-icon'
  />
);

export function useCreateListGroupRow(groupFieldId?: string, groupId?: string, openAfterCreate = false) {
  const fields = useDatabaseFields();
  const view = useDatabaseView();
  const createRow = useNewRowDispatch();

  return useCallback(async () => {
    await createRow({
      cellsData: getListGroupCellsData(fields, groupFieldId, groupId, view),
      openAfterCreate,
      tailing: true,
    });
  }, [createRow, fields, groupFieldId, groupId, openAfterCreate, view]);
}

export function ListGroupHeader({
  fieldId,
  fieldName,
  fieldType,
  group,
  groupConfigId,
  className,
  openAfterCreate = false,
  variant = 'list',
  onDeleteGroup,
}: {
  fieldId?: string;
  fieldName?: string;
  fieldType?: FieldType;
  group: GridGroup;
  groupConfigId?: string;
  /** Overrides the List's height and gutter, e.g. for the timeline's 36px rows. */
  className?: string;
  openAfterCreate?: boolean;
  /**
   * `gallery` follows the Figma gallery group header (node 7435:211111): a 4px
   * gap after the toggle, a 14px medium option tag and count, 24px secondary
   * actions, and a Hide group / Delete menu instead of Remove grouping.
   */
  variant?: 'list' | 'gallery';
  /** Gallery only: shows Delete in the group menu. */
  onDeleteGroup?: () => void;
}) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const toggleCollapsed = useToggleListGroupCollapsedDispatch(groupConfigId);
  const setVisibility = useSetListGroupVisibilityDispatch(groupConfigId, fieldId);
  const clearGrouping = useClearGroupByFieldDispatch();
  const createRow = useCreateListGroupRow(fieldId, group.id, openAfterCreate);
  const { pending, run } = useRowCreationAction();
  const isCheckbox = fieldType === FieldType.Checkbox;
  const isChecked = group.id === 'Yes';
  const isGallery = variant === 'gallery';
  const actionButtonClassName = isGallery
    ? 'h-6 w-6 rounded-200 p-0.5 text-icon-secondary opacity-0 focus-visible:opacity-100 group-focus-within/list-group-header:opacity-100 group-hover/list-group-header:opacity-100 data-[state=open]:opacity-100'
    : 'h-7 w-7 rounded-[4px] p-1 opacity-0 focus-visible:opacity-100 group-focus-within/list-group-header:opacity-100 group-hover/list-group-header:opacity-100 data-[state=open]:opacity-100';
  const actionIconClassName = isGallery ? 'h-5 w-5' : 'h-4 w-4';
  const optionBackgroundToken = group.option ? SelectOptionColorMap[group.option.color] : undefined;
  const optionTextToken = group.option ? SelectOptionFgColorMap[group.option.color] : undefined;

  return (
    <div
      className={cn(
        'group/list-group-header flex min-w-0 items-center pr-1 text-sm text-text-primary',
        className ?? 'h-11 pl-10'
      )}
      data-group-id={group.id}
      data-testid={`list-group-header-${group.id}`}
    >
      <Button
        aria-expanded={!group.collapsed}
        aria-label={group.collapsed ? t('button.expand', 'Expand group') : t('button.collapse', 'Collapse group')}
        className={isGallery ? 'mr-1' : 'mr-2'}
        data-testid='list-group-collapse-toggle'
        onClick={() => toggleCollapsed(group.id, !group.collapsed)}
        size='icon-sm'
        type='button'
        variant='ghost'
      >
        {group.collapsed ? collapsedIcon : expandedIcon}
      </Button>

      {group.option ? (
        <div
          className='min-w-0'
          data-background-color-token={optionBackgroundToken}
          data-testid='list-group-option-tag'
          data-text-color-token={optionTextToken}
        >
          {isGallery ? (
            <span
              className='block max-w-[360px] truncate rounded-[6px] px-2 py-px text-sm font-medium leading-5'
              style={{
                backgroundColor: optionBackgroundToken ? `var(${optionBackgroundToken})` : undefined,
                color: `var(${optionTextToken || '--text-primary'})`,
              }}
            >
              {group.option.name}
            </span>
          ) : (
            <Tag bgColor={optionBackgroundToken} label={group.option.name} textColor={optionTextToken} />
          )}
        </div>
      ) : isCheckbox ? (
        <div className='flex min-w-0 items-center gap-1'>
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

      <span className={cn('ml-2 px-1 py-px text-text-secondary', isGallery && 'font-medium')} data-testid='list-group-row-count'>
        {group.rows.length}
      </span>

      {!readOnly ? (
        <>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                aria-label={t('button.more', 'Group actions')}
                className={cn('ml-2', actionButtonClassName)}
                data-testid='list-group-actions'
                size='icon'
                type='button'
                variant='ghost'
              >
                <MoreIcon aria-hidden='true' className={actionIconClassName} />
              </Button>
            </DropdownMenuTrigger>
            {isGallery ? (
              <DropdownMenuContent align='start' className='w-[240px] !min-w-[240px]'>
                <DropdownMenuItem data-testid='list-hide-group' onSelect={() => setVisibility(group.id, false)}>
                  <HideIcon aria-hidden='true' />
                  {t('grid.settings.hideGroup', 'Hide group')}
                </DropdownMenuItem>
                {onDeleteGroup ? (
                  <DropdownMenuItem data-testid='gallery-delete-group' onSelect={onDeleteGroup} variant='destructive'>
                    <DeleteIcon aria-hidden='true' />
                    {t('button.delete')}
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            ) : (
              <DropdownMenuContent align='start' className='min-w-[180px]'>
                <DropdownMenuItem data-testid='list-hide-group' onSelect={() => setVisibility(group.id, false)}>
                  {t('grid.settings.hideGroup', 'Hide group')}
                </DropdownMenuItem>
                <DropdownMenuItem data-testid='list-remove-grouping' onSelect={clearGrouping} variant='destructive'>
                  {t('board.removeGrouping', 'Remove grouping')}
                </DropdownMenuItem>
              </DropdownMenuContent>
            )}
          </DropdownMenu>
          {/* Desktop GroupAddButton: AFTooltip("Create a new") around the ghost plus button. */}
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                aria-label={t('grid.row.newRow', 'New row in group')}
                className={actionButtonClassName}
                data-testid='list-group-new-row'
                disabled={pending}
                loading={pending}
                onClick={() => void run(createRow)}
                size='icon'
                type='button'
                variant='ghost'
              >
                {pending ? <RowCreationSpinner /> : <PlusIcon aria-hidden='true' className={actionIconClassName} />}
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('grid.selectOption.createNew', 'Create a new')}</TooltipContent>
          </Tooltip>
        </>
      ) : null}
    </div>
  );
}

export function ListGroupFooter({ fieldId, groupId }: { fieldId?: string; groupId: string }) {
  const { t } = useTranslation();
  const createRow = useCreateListGroupRow(fieldId, groupId);
  const { pending, run } = useRowCreationAction();

  return (
    <div className='ml-10 h-9 px-1' data-testid={`list-group-footer-${groupId}`}>
      <button
        className='flex h-9 w-full items-center gap-1.5 rounded-[6px] px-2 text-left text-sm text-text-tertiary hover:bg-fill-content-hover'
        disabled={pending}
        aria-busy={pending}
        onClick={() => void run(createRow)}
        type='button'
      >
        {pending ? <RowCreationSpinner /> : <PlusIcon aria-hidden='true' className='h-4 w-4' />}
        {t('grid.row.newRow')}
      </button>
    </div>
  );
}

export function ListGroupSeparator() {
  return <div aria-hidden className='h-3' />;
}
