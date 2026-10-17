import { type KeyboardEvent, type PointerEvent, type RefObject, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DateGroupCondition, FieldType, usePropertiesSelector } from '@/application/database-yjs';
import type { GridGroup, GridGrouping } from '@/application/database-yjs';
import {
  useClearGroupByFieldDispatch,
  useGroupByFieldDispatch,
  useSetGridGroupVisibilityDispatch,
  useToggleGridHideEmptyGroups,
  useUpdateDateGroupConditionDispatch,
  useUpdateNumberGroupConfigurationDispatch,
} from '@/application/database-yjs/dispatch';
import { DATABASE_GROUPABLE_FIELD_TYPES, parseDateGroupConfiguration } from '@/application/database-yjs/group';
import { type NumberGroupConfiguration, parseNumberGroupConfiguration } from '@/application/database-yjs/number-grouping';
import { DatabaseViewLayout } from '@/application/types';
import { ReactComponent as DeleteIcon } from '@/assets/icons/delete.svg';
import { ReactComponent as GroupIcon } from '@/assets/icons/group.svg';
import { ReactComponent as HideIcon } from '@/assets/icons/hide.svg';
import { ReactComponent as ShowIcon } from '@/assets/icons/show.svg';
import { Tag } from '@/components/_shared/tag';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';
import { FieldDisplay } from '@/components/database/components/field';
import { NumberGroupSettings } from '@/components/database/components/settings/NumberGroupSettings';
import { useGridGrouping } from '@/components/database/grid/GridGroupingContext';
import {
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';
import { cn } from '@/lib/utils';

const DATE_CONDITIONS = [
  { label: 'Relative', value: DateGroupCondition.Relative },
  { label: 'Day', value: DateGroupCondition.Day },
  { label: 'Week', value: DateGroupCondition.Week },
  { label: 'Month', value: DateGroupCondition.Month },
  { label: 'Year', value: DateGroupCondition.Year },
] as const;

export const GRID_GROUP_VISIBILITY_LIMIT = 40;

/**
 * One row of the "Groups" section. Grid/List/Timeline pass their `GridGroup`s
 * straight through; Board derives rows from its columns.
 */
export type DatabaseSettingGroupVisibilityGroup = Pick<GridGroup, 'id' | 'label' | 'option' | 'isDefault'> & {
  /** Grid/List/Timeline: the persisted flag. Board: whether the column is currently rendered. */
  visible: boolean;
  rows?: unknown[];
};

export type DatabaseSettingGrouping = Pick<
  GridGrouping,
  'isGrouped' | 'fieldId' | 'fieldType' | 'fieldName' | 'content' | 'hideEmptyGroups'
> & {
  /** Rows for the "Groups" section, already filtered per layout rule. */
  groups: DatabaseSettingGroupVisibilityGroup[];
};

export interface DatabaseSettingGroupProps {
  grouping: DatabaseSettingGrouping;
  /** Board hides "None" and "Delete grouping" because it must always stay grouped. */
  layout: DatabaseViewLayout;
  /** Groupable fields, already filtered per layout. */
  properties: Array<{ id: string; type: FieldType }>;
  groupBy: (fieldId: string) => void;
  clearGrouping: () => void;
  toggleHideEmpty: (hide: boolean) => void;
  setVisibility: (groupId: string, visible: boolean) => void;
  /** Grid/List/Timeline only: enables the "Group condition" section for Date groupings. */
  updateDateCondition?: (condition: DateGroupCondition) => void;
  /** Grid/List/Timeline only: enables the Number panel. */
  updateNumberConfiguration?: (configuration: NumberGroupConfiguration) => void;
  testIdPrefix: 'grid' | 'list' | 'timeline' | 'board';
  /** Board BDD steps rely on the constant id 'board-group-by-field'; default `${prefix}-group-by-field-${fieldId}`. */
  groupByFieldTestId?: (fieldId: string) => string;
}

/**
 * Desktop's backend (view_editor.rs `v_load_groups`) drops empty groups from
 * the "Groups" list while "Hide empty groups" is on and lists every group,
 * empty ones included, while it is off. Stale row-derived IDs that web only
 * retains as metadata never render, so they are not offered either.
 */
export function getDatabaseGroupVisibilityGroups(grouping: Pick<GridGrouping, 'groups' | 'hideEmptyGroups'>): GridGroup[] {
  return grouping.groups.filter((group) =>
    grouping.hideEmptyGroups ? group.rows.length > 0 : !group.automaticallyHidden
  );
}

/** Desktop lists every `canBeGroup` field of the view, hidden fields included. */
export function useGroupableProperties() {
  const { properties } = usePropertiesSelector(true);

  return useMemo(
    () => properties.filter((property) => DATABASE_GROUPABLE_FIELD_TYPES.includes(property.type)),
    [properties]
  );
}

/** Grid/List/Timeline grouping state reduced to the menu's props contract. */
export function useDatabaseSettingGrouping(grouping: GridGrouping): DatabaseSettingGrouping {
  return useMemo(() => {
    const { isGrouped, fieldId, fieldType, fieldName, content, hideEmptyGroups } = grouping;

    return {
      isGrouped,
      fieldId,
      fieldType,
      fieldName,
      content,
      hideEmptyGroups,
      groups: getDatabaseGroupVisibilityGroups(grouping),
    };
  }, [grouping]);
}

function keepSubmenuOpenOnPointerLeave(contentRef: RefObject<HTMLDivElement | null>) {
  return (event: PointerEvent<HTMLDivElement>) => {
    // Entering the portaled submenu must not focus the parent menu and
    // dismiss the draft when Radix's geometric hover grace area is missed.
    if (event.relatedTarget instanceof Node && contentRef.current?.contains(event.relatedTarget)) {
      event.preventDefault();
    }
  };
}

function GridGroupVisibilityLabel({
  group,
  testIdPrefix,
}: {
  group: DatabaseSettingGroupVisibilityGroup;
  testIdPrefix: string;
}) {
  if (!group.option) return <span className='truncate'>{group.label}</span>;

  const backgroundToken = SelectOptionColorMap[group.option.color];
  const textToken = SelectOptionFgColorMap[group.option.color];

  return (
    <div
      className='min-w-0'
      data-background-color-token={backgroundToken}
      data-testid={`${testIdPrefix}-group-visibility-option-tag-${group.id}`}
      data-text-color-token={textToken}
    >
      <Tag bgColor={backgroundToken} label={group.option.name} textColor={textToken} />
    </div>
  );
}

export function GridGroupVisibilityList({
  groups,
  setVisibility,
  testIdPrefix = 'grid',
}: {
  groups: DatabaseSettingGroupVisibilityGroup[];
  setVisibility: (groupId: string, visible: boolean) => void;
  testIdPrefix?: string;
}) {
  const { t } = useTranslation();
  const [searchValue, setSearchValue] = useState('');
  const searchEnabled = groups.length > GRID_GROUP_VISIBILITY_LIMIT;
  // Ignore stale text as soon as a newly selected field no longer needs the
  // search control. DatabaseSettingGroup also keys this list by field id so a
  // different grouping field starts with a clean query.
  const normalizedSearch = searchEnabled ? searchValue.trim().toLocaleLowerCase() : '';
  const filteredGroups = useMemo(() => {
    if (!normalizedSearch) return groups;

    return groups.filter(
      (group) =>
        group.label.toLocaleLowerCase().includes(normalizedSearch) ||
        group.id.toLocaleLowerCase().includes(normalizedSearch)
    );
  }, [groups, normalizedSearch]);
  const renderedGroups = filteredGroups.slice(0, GRID_GROUP_VISIBILITY_LIMIT);
  const isLimited = renderedGroups.length < filteredGroups.length;
  const handleSearchKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.ctrlKey || event.altKey || event.metaKey || event.key.length !== 1) return;

    // Radix uses printable keys for menu typeahead. Keep them in the search
    // box instead. Space is also a menu selection key, so insert it ourselves
    // before Radix suppresses the native input action.
    event.stopPropagation();
    if (event.key !== ' ') return;

    event.preventDefault();
    const input = event.currentTarget;
    const selectionStart = input.selectionStart ?? searchValue.length;
    const selectionEnd = input.selectionEnd ?? selectionStart;
    const nextValue = `${searchValue.slice(0, selectionStart)} ${searchValue.slice(selectionEnd)}`;

    setSearchValue(nextValue);
    window.setTimeout(() => input.setSelectionRange(selectionStart + 1, selectionStart + 1));
  };

  return (
    <>
      {searchEnabled && (
        <div className='sticky top-0 z-[1] bg-surface-primary py-1'>
          <DropdownMenuItem asChild onSelect={(event) => event.preventDefault()}>
            <input
              aria-label={t('searchLabel', 'Search groups')}
              autoComplete='off'
              className='h-8 w-full cursor-text rounded-300 border border-border-primary bg-fill-content px-2 text-sm text-text-primary outline-none placeholder:text-text-tertiary focus:border-border-theme-thick focus:ring-[0.5px] focus:ring-border-theme-thick'
              data-testid={`${testIdPrefix}-group-visibility-search`}
              onChange={(event) => setSearchValue(event.target.value)}
              onKeyDown={handleSearchKeyDown}
              placeholder={t('searchLabel', 'Search groups')}
              role='searchbox'
              type='search'
              value={searchValue}
            />
          </DropdownMenuItem>
        </div>
      )}

      {renderedGroups.map((group) => (
        <DropdownMenuItem
          aria-checked={group.visible}
          data-testid={`${testIdPrefix}-group-visibility-${group.id}`}
          key={group.id}
          onSelect={(event) => {
            event.preventDefault();
            setVisibility(group.id, !group.visible);
          }}
          role='menuitemcheckbox'
        >
          <GridGroupVisibilityLabel group={group} testIdPrefix={testIdPrefix} />
          {/* Desktop _GroupVisibilityRow: show_s in icon-secondary while visible, hide_m in icon-tertiary while hidden. */}
          {group.visible ? (
            <ShowIcon
              aria-hidden='true'
              className='ml-auto text-icon-secondary'
              data-testid={`${testIdPrefix}-group-visibility-shown-${group.id}`}
            />
          ) : (
            <HideIcon
              aria-hidden='true'
              className='ml-auto text-icon-tertiary'
              data-testid={`${testIdPrefix}-group-visibility-hidden-${group.id}`}
            />
          )}
        </DropdownMenuItem>
      ))}

      {filteredGroups.length === 0 && (
        <div
          className='px-3 py-2 text-sm text-text-secondary'
          data-testid={`${testIdPrefix}-group-visibility-empty`}
          role='status'
        >
          {t('grid.settings.noMatchingGroups', { defaultValue: 'No matching groups' })}
        </div>
      )}

      {isLimited && (
        <div
          className='px-3 py-2 text-xs text-text-secondary'
          data-testid={`${testIdPrefix}-group-visibility-limit`}
          role='status'
        >
          {t('grid.settings.groupVisibilityLimited', {
            defaultValue: 'Showing {{shown}} of {{total}} groups. Search to find more.',
            shown: renderedGroups.length,
            total: filteredGroups.length,
          })}
        </div>
      )}
    </>
  );
}

/** Desktop _EmptyGroupByList: "Group by" label, optional None, then every groupable field. */
function GroupByFieldList({
  clearGrouping,
  groupBy,
  groupByFieldTestId,
  grouping,
  properties,
  showNone,
  testIdPrefix,
}: Pick<
  DatabaseSettingGroupProps,
  'clearGrouping' | 'groupBy' | 'groupByFieldTestId' | 'grouping' | 'properties' | 'testIdPrefix'
> & {
  showNone: boolean;
}) {
  const { t } = useTranslation();

  return (
    <>
      <DropdownMenuLabel>{t('board.groupBy', 'Group by')}</DropdownMenuLabel>
      {showNone && (
        <DropdownMenuItem
          data-testid={`${testIdPrefix}-group-by-none`}
          onSelect={(event) => {
            event.preventDefault();
            clearGrouping();
          }}
        >
          {t('grid.calculationTypeLabel.none', 'None')}
          {!grouping.isGrouped && <DropdownMenuItemTick />}
        </DropdownMenuItem>
      )}
      {properties.map((property) => (
        <DropdownMenuItem
          data-testid={groupByFieldTestId?.(property.id) ?? `${testIdPrefix}-group-by-field-${property.id}`}
          key={property.id}
          onSelect={(event) => {
            event.preventDefault();
            groupBy(property.id);
          }}
        >
          <FieldDisplay
            className='min-w-0 flex-1'
            data-testid={`${testIdPrefix}-group-by-field-name`}
            fieldId={property.id}
          />
          {grouping.fieldId === property.id && (
            <DropdownMenuItemTick data-testid={`${testIdPrefix}-group-by-field-selected`} />
          )}
        </DropdownMenuItem>
      ))}
    </>
  );
}

/**
 * The "Group" settings submenu, structured like desktop's DatabaseGroupList:
 * ungrouped = Group by / None / fields; grouped = Group by ▸ field → [Number
 * panel] → Hide empty groups → Groups rows → [Group condition] → [Delete
 * grouping].
 */
export function DatabaseSettingGroup({
  clearGrouping,
  groupBy,
  groupByFieldTestId,
  grouping,
  layout,
  properties,
  setVisibility,
  testIdPrefix,
  toggleHideEmpty,
  updateDateCondition,
  updateNumberConfiguration,
}: DatabaseSettingGroupProps) {
  const { t } = useTranslation();
  const contentRef = useRef<HTMLDivElement>(null);
  const groupByContentRef = useRef<HTMLDivElement>(null);
  const isBoard = layout === DatabaseViewLayout.Board;
  const isNumber = grouping.fieldType === FieldType.Number;
  const dateFieldId = grouping.fieldType === FieldType.DateTime ? grouping.fieldId : undefined;
  const currentDateCondition = parseDateGroupConfiguration(grouping.content).condition;
  const fieldList = (
    <GroupByFieldList
      clearGrouping={clearGrouping}
      groupBy={groupBy}
      groupByFieldTestId={groupByFieldTestId}
      grouping={grouping}
      properties={properties}
      showNone={!isBoard}
      testIdPrefix={testIdPrefix}
    />
  );

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger
        data-testid={`${testIdPrefix}-group-settings-trigger`}
        onPointerLeave={keepSubmenuOpenOnPointerLeave(contentRef)}
      >
        <GroupIcon />
        <span className='min-w-0 flex-1 truncate'>{t('grid.settings.group', 'Group')}</span>
        {grouping.isGrouped && grouping.fieldName ? (
          <span
            className='max-w-[80px] truncate text-xs text-text-secondary'
            data-testid={`${testIdPrefix}-group-settings-field`}
          >
            {grouping.fieldName}
          </span>
        ) : null}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent
          ref={contentRef}
          className={cn('appflowy-scroller w-[240px] overflow-y-auto', isNumber ? 'max-h-[560px]' : 'max-h-[280px]')}
          data-testid={`${testIdPrefix}-group-settings-menu`}
        >
          {!grouping.isGrouped ? (
            fieldList
          ) : (
            <>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger
                  data-testid={`${testIdPrefix}-group-by-trigger`}
                  onPointerLeave={keepSubmenuOpenOnPointerLeave(groupByContentRef)}
                >
                  <span className='min-w-0 flex-1 truncate'>{t('board.groupBy', 'Group by')}</span>
                  {grouping.fieldName ? (
                    <span
                      className='max-w-[80px] truncate text-text-secondary'
                      data-testid={`${testIdPrefix}-group-by-current-field`}
                    >
                      {grouping.fieldName}
                    </span>
                  ) : null}
                </DropdownMenuSubTrigger>
                <DropdownMenuPortal>
                  <DropdownMenuSubContent
                    ref={groupByContentRef}
                    className='appflowy-scroller max-h-[280px] w-[240px] overflow-y-auto'
                    data-testid={`${testIdPrefix}-group-by-menu`}
                  >
                    {fieldList}
                  </DropdownMenuSubContent>
                </DropdownMenuPortal>
              </DropdownMenuSub>

              {isNumber && updateNumberConfiguration && (
                <>
                  <DropdownMenuSeparator />
                  <NumberGroupSettings
                    configuration={parseNumberGroupConfiguration(grouping.content)}
                    key={grouping.fieldId}
                    onChange={updateNumberConfiguration}
                    testIdPrefix={testIdPrefix}
                  />
                  <DropdownMenuSeparator />
                </>
              )}

              {/* Desktop hides the toggle for Checkbox groupings: "Yes"/"No" never go empty. */}
              {grouping.fieldType !== FieldType.Checkbox && (
                <DropdownMenuItem
                  aria-checked={grouping.hideEmptyGroups}
                  className='w-full'
                  data-testid={`${testIdPrefix}-hide-empty-groups-toggle`}
                  onSelect={(event) => {
                    event.preventDefault();
                    toggleHideEmpty(!grouping.hideEmptyGroups);
                  }}
                  role='menuitemcheckbox'
                >
                  {t('board.hideEmptyGroups', 'Hide empty groups')}
                  <Switch
                    aria-hidden='true'
                    checked={grouping.hideEmptyGroups}
                    className='pointer-events-none ml-auto'
                    data-testid={`${testIdPrefix}-hide-empty-groups-switch`}
                    tabIndex={-1}
                  />
                </DropdownMenuItem>
              )}

              <DropdownMenuLabel>{t('board.groups', 'Groups')}</DropdownMenuLabel>
              <GridGroupVisibilityList
                groups={grouping.groups}
                key={grouping.fieldId}
                setVisibility={setVisibility}
                testIdPrefix={testIdPrefix}
              />

              {dateFieldId && updateDateCondition && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t('board.groupCondition', 'Group condition')}</DropdownMenuLabel>
                  {DATE_CONDITIONS.map((condition) => (
                    // Desktop reuses its field row here, so each condition carries
                    // the date field's icon, and selecting one dismisses the menu.
                    <DropdownMenuItem
                      data-testid={`${testIdPrefix}-date-group-condition-${condition.value}`}
                      key={condition.value}
                      onSelect={() => updateDateCondition(condition.value)}
                    >
                      <FieldDisplay
                        data-testid={`${testIdPrefix}-date-group-condition-field-icon`}
                        fieldId={dateFieldId}
                        showPropertyName={false}
                      />
                      <span className='truncate'>
                        {t(`chart.dateGrouping.${condition.label.toLowerCase()}`, condition.label)}
                      </span>
                      {currentDateCondition === condition.value && <DropdownMenuItemTick />}
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              {!isBoard && (
                <>
                  <DropdownMenuSeparator />
                  {/* Desktop buildDeleteGroupItem: primary at rest, error colored only while hovered or focused. */}
                  <DropdownMenuItem
                    className='group/delete-grouping hover:text-text-error focus:text-text-error'
                    data-testid={`${testIdPrefix}-remove-grouping`}
                    onSelect={clearGrouping}
                  >
                    <DeleteIcon className='text-icon-primary group-hover/delete-grouping:text-text-error group-focus/delete-grouping:text-text-error' />
                    {t('board.deleteGroup', 'Delete grouping')}
                  </DropdownMenuItem>
                </>
              )}
            </>
          )}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

function GridSettingGroup() {
  const grouping = useGridGrouping();
  const groupBy = useGroupByFieldDispatch();
  const clearGrouping = useClearGroupByFieldDispatch();
  const toggleHideEmpty = useToggleGridHideEmptyGroups();
  const setVisibility = useSetGridGroupVisibilityDispatch(grouping.groupId, grouping.fieldId);
  const updateDateCondition = useUpdateDateGroupConditionDispatch();
  const updateNumberConfiguration = useUpdateNumberGroupConfigurationDispatch();
  const properties = useGroupableProperties();
  const settingGrouping = useDatabaseSettingGrouping(grouping);

  return (
    <DatabaseSettingGroup
      clearGrouping={clearGrouping}
      groupBy={groupBy}
      grouping={settingGrouping}
      layout={DatabaseViewLayout.Grid}
      properties={properties}
      setVisibility={setVisibility}
      testIdPrefix='grid'
      toggleHideEmpty={toggleHideEmpty}
      updateDateCondition={updateDateCondition}
      updateNumberConfiguration={updateNumberConfiguration}
    />
  );
}

export default GridSettingGroup;
