import { type KeyboardEvent, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { DateGroupCondition, FieldType, usePropertiesSelector } from '@/application/database-yjs';
import type { GridGroup, GridGrouping } from '@/application/database-yjs';
import {
  useClearGroupByFieldDispatch,
  useGroupByFieldDispatch,
  useSetAllGridGroupsVisibilityDispatch,
  useSetGridGroupVisibilityDispatch,
  useToggleGridHideEmptyGroups,
  useUpdateDateGroupConditionDispatch,
} from '@/application/database-yjs/dispatch';
import {
  DATABASE_GROUPABLE_FIELD_TYPES,
  isDynamicDatabaseGroupFieldType,
  parseDateGroupConfiguration,
} from '@/application/database-yjs/group';
import { ReactComponent as GroupIcon } from '@/assets/icons/group.svg';
import { Tag } from '@/components/_shared/tag';
import { SelectOptionColorMap, SelectOptionFgColorMap } from '@/components/database/components/cell/cell.const';
import { FieldDisplay } from '@/components/database/components/field';
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

const DATE_CONDITIONS = [
  { label: 'Relative', value: DateGroupCondition.Relative },
  { label: 'Day', value: DateGroupCondition.Day },
  { label: 'Week', value: DateGroupCondition.Week },
  { label: 'Month', value: DateGroupCondition.Month },
  { label: 'Year', value: DateGroupCondition.Year },
] as const;

export const GRID_GROUP_VISIBILITY_LIMIT = 40;

export function getGridGroupVisibilityGroups(groups: GridGroup[], fieldType?: FieldType): GridGroup[] {
  if (fieldType === undefined || !isDynamicDatabaseGroupFieldType(fieldType)) return groups;

  return groups.filter((group) => group.isDefault || group.rows.length > 0);
}

function GridGroupVisibilityLabel({ group, testIdPrefix }: { group: GridGroup; testIdPrefix: string }) {
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
  groups: GridGroup[];
  setVisibility: (groupId: string, visible: boolean) => void;
  testIdPrefix?: string;
}) {
  const { t } = useTranslation();
  const [searchValue, setSearchValue] = useState('');
  const searchEnabled = groups.length > GRID_GROUP_VISIBILITY_LIMIT;
  // Ignore stale text as soon as a newly selected field no longer needs the
  // search control. GridSettingGroup also keys this list by field id so a
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
          aria-checked={!group.hidden}
          data-testid={`${testIdPrefix}-group-visibility-${group.id}`}
          key={group.id}
          onSelect={(event) => {
            event.preventDefault();
            setVisibility(group.id, group.hidden);
          }}
          role='menuitemcheckbox'
        >
          <GridGroupVisibilityLabel group={group} testIdPrefix={testIdPrefix} />
          <Switch
            aria-hidden='true'
            checked={!group.hidden}
            className='pointer-events-none ml-auto'
            data-testid={`${testIdPrefix}-group-visibility-switch-${group.id}`}
            tabIndex={-1}
          />
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

export function GridGroupVisibilityActions({
  groups,
  setAllVisibility,
  testIdPrefix = 'grid',
}: {
  groups: GridGroup[];
  setAllVisibility: (groupIds: string[], visible: boolean) => void;
  testIdPrefix?: string;
}) {
  const { t } = useTranslation();
  const groupIds = useMemo(() => groups.filter((group) => !group.isDefault).map((group) => group.id), [groups]);

  if (groupIds.length === 0) return null;

  return (
    <>
      <DropdownMenuItem
        data-testid={`${testIdPrefix}-show-all-groups`}
        onSelect={(event) => {
          event.preventDefault();
          setAllVisibility(groupIds, true);
        }}
      >
        {t('board.showAllGroups', 'Show all')}
      </DropdownMenuItem>
      <DropdownMenuItem
        data-testid={`${testIdPrefix}-hide-all-groups`}
        onSelect={(event) => {
          event.preventDefault();
          setAllVisibility(groupIds, false);
        }}
      >
        {t('board.hideAllGroups', 'Hide all')}
      </DropdownMenuItem>
    </>
  );
}

interface DatabaseSettingGroupProps {
  grouping: GridGrouping;
  groupBy: (fieldId: string) => void;
  clearGrouping: () => void;
  toggleHideEmpty: (hide: boolean) => void;
  setVisibility: (groupId: string, visible: boolean) => void;
  setAllVisibility: (groupIds: string[], visible: boolean) => void;
  updateDateCondition: (condition: DateGroupCondition) => void;
  testIdPrefix: 'grid' | 'list';
}

export function DatabaseSettingGroup({
  grouping,
  groupBy,
  clearGrouping,
  toggleHideEmpty,
  setVisibility,
  setAllVisibility,
  updateDateCondition,
  testIdPrefix,
}: DatabaseSettingGroupProps) {
  const { t } = useTranslation();
  const { properties: allProperties } = usePropertiesSelector(true);
  const properties = useMemo(
    () => allProperties.filter((property) => DATABASE_GROUPABLE_FIELD_TYPES.includes(property.type)),
    [allProperties]
  );
  const visibilityGroups = useMemo(
    () => getGridGroupVisibilityGroups(grouping.groups, grouping.fieldType),
    [grouping.fieldType, grouping.groups]
  );
  const currentDateCondition = parseDateGroupConfiguration(grouping.content).condition;

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid={`${testIdPrefix}-group-settings-trigger`}>
        <GroupIcon />
        {t('grid.settings.group', 'Group')}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent
          className='appflowy-scroller max-h-[520px] max-w-[280px] overflow-y-auto'
          data-testid={`${testIdPrefix}-group-settings-menu`}
        >
          {grouping.isGrouped && (
            <>
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

              {grouping.fieldType === FieldType.DateTime && (
                <>
                  <DropdownMenuLabel>{t('grid.settings.groupDateBy', 'Group dates by')}</DropdownMenuLabel>
                  {DATE_CONDITIONS.map((condition) => (
                    <DropdownMenuItem
                      data-testid={`${testIdPrefix}-date-group-condition-${condition.value}`}
                      key={condition.value}
                      onSelect={(event) => {
                        event.preventDefault();
                        updateDateCondition(condition.value);
                      }}
                    >
                      {t(`chart.dateGrouping.${condition.label.toLowerCase()}`, condition.label)}
                      {currentDateCondition === condition.value && <DropdownMenuItemTick />}
                    </DropdownMenuItem>
                  ))}
                </>
              )}

              {visibilityGroups.length > 0 && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuLabel>{t('grid.settings.groupVisibility', 'Group visibility')}</DropdownMenuLabel>
                  <GridGroupVisibilityActions
                    groups={visibilityGroups}
                    setAllVisibility={setAllVisibility}
                    testIdPrefix={testIdPrefix}
                  />
                  <GridGroupVisibilityList
                    groups={visibilityGroups}
                    key={grouping.fieldId}
                    setVisibility={setVisibility}
                    testIdPrefix={testIdPrefix}
                  />
                </>
              )}

              <DropdownMenuSeparator />
              <DropdownMenuItem
                data-testid={`${testIdPrefix}-remove-grouping`}
                onSelect={clearGrouping}
                variant='destructive'
              >
                {t('board.removeGrouping', 'Remove grouping')}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          <DropdownMenuLabel>{t('board.groupBy', 'Group by')}</DropdownMenuLabel>
          <DropdownMenuItem
            data-testid={`${testIdPrefix}-group-by-none`}
            onSelect={(event) => {
              event.preventDefault();
              clearGrouping();
            }}
          >
            {t('button.none', 'None')}
            {!grouping.isGrouped && <DropdownMenuItemTick />}
          </DropdownMenuItem>
          {properties.map((property) => (
            <DropdownMenuItem
              data-testid={`${testIdPrefix}-group-by-field-${property.id}`}
              key={property.id}
              onSelect={(event) => {
                event.preventDefault();
                groupBy(property.id);
              }}
            >
              <FieldDisplay fieldId={property.id} />
              {grouping.fieldId === property.id && <DropdownMenuItemTick />}
            </DropdownMenuItem>
          ))}
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
  const setAllVisibility = useSetAllGridGroupsVisibilityDispatch(grouping.groupId, grouping.fieldId);
  const updateDateCondition = useUpdateDateGroupConditionDispatch();

  return (
    <DatabaseSettingGroup
      clearGrouping={clearGrouping}
      groupBy={groupBy}
      grouping={grouping}
      setAllVisibility={setAllVisibility}
      setVisibility={setVisibility}
      testIdPrefix='grid'
      toggleHideEmpty={toggleHideEmpty}
      updateDateCondition={updateDateCondition}
    />
  );
}

export default GridSettingGroup;
