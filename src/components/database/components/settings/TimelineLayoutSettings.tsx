import dayjs from 'dayjs';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  FieldType,
  parseRelationTypeOption,
  TimelineDependencyDirection,
  TimelineDependencyShift,
  useDatabase,
  useDatabaseFields,
  usePrimaryFieldId,
  usePropertiesSelector,
  useTimelineLayoutSetting,
} from '@/application/database-yjs';
import { useUpdateTimelineSetting } from '@/application/database-yjs/dispatch';
import { useSetUpTimelineDependenciesDispatch } from '@/application/database-yjs/dispatch/timeline-dependencies';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { ReactComponent as TimelineIcon } from '@/assets/icons/timeline.svg';
import { FieldDisplay } from '@/components/database/components/field';
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

const DATE_FIELD_TYPES = [FieldType.DateTime, FieldType.LastEditedTime, FieldType.CreatedTime];

// Which side of the relation the bound field lists.
const DIRECTION_OPTIONS = [
  { value: TimelineDependencyDirection.BlockedBy, labelKey: 'timeline.blockedBy', fallback: 'Blocked by' },
  { value: TimelineDependencyDirection.Blocking, labelKey: 'timeline.blocking', fallback: 'Blocking' },
];

// Notion's "Shift dependents" choices, in its order.
const SHIFT_OPTIONS = [
  {
    value: TimelineDependencyShift.OverlapOnly,
    labelKey: 'timeline.settings.shiftOverlapOnly',
    fallback: 'Only when dates overlap',
  },
  {
    value: TimelineDependencyShift.MaintainGap,
    labelKey: 'timeline.settings.shiftMaintainGap',
    fallback: 'Keep the time between items',
  },
  { value: TimelineDependencyShift.Never, labelKey: 'timeline.settings.shiftNever', fallback: 'Never' },
];

function TimelineLayoutSettings() {
  const { t } = useTranslation();
  const setting = useTimelineLayoutSetting();
  const updateSetting = useUpdateTimelineSetting();
  const setUpDependencies = useSetUpTimelineDependenciesDispatch();
  const database = useDatabase();
  const fields = useDatabaseFields();
  const databaseId = database?.get(YjsDatabaseKey.id);

  const { properties: allProperties } = usePropertiesSelector(false);
  const dateProperties = useMemo(
    () => allProperties.filter((property) => DATE_FIELD_TYPES.includes(property.type)),
    [allProperties]
  );
  // Every non-primary property may become a table column (the title is always the first column).
  const primaryFieldId = usePrimaryFieldId();
  const tableProperties = useMemo(
    () => allProperties.filter((property) => property.id !== primaryFieldId),
    [allProperties, primaryFieldId]
  );
  // Notion's "separate start and end dates": any other date field can end the bar.
  const endDateProperties = useMemo(
    () => dateProperties.filter((property) => property.id !== setting.fieldId),
    [dateProperties, setting.fieldId]
  );
  // Only relations that point back at this database can express dependencies.
  const dependencyProperties = useMemo(
    () =>
      allProperties.filter((property) => {
        if (property.type !== FieldType.Relation) return false;
        const field = fields?.get(property.id);

        return Boolean(field) && parseRelationTypeOption(field)?.database_id === databaseId;
      }),
    [allProperties, databaseId, fields]
  );
  const progressProperties = useMemo(
    () => allProperties.filter((property) => property.type === FieldType.Number),
    [allProperties]
  );

  const weekDays = useMemo(
    () =>
      Array.from({ length: 2 }, (_, i) => ({
        value: i,
        name: dayjs().day(i).format('ddd'),
      })),
    []
  );

  const renderOptionalField = (
    label: string,
    testIdPrefix: string,
    options: typeof allProperties,
    value: string,
    onChange: (fieldId: string) => void
  ) => (
    <>
      <DropdownMenuLabel>{label}</DropdownMenuLabel>
      <DropdownMenuItem
        className={'w-full'}
        data-testid={`${testIdPrefix}-none`}
        onSelect={(e) => {
          e.preventDefault();
          onChange('');
        }}
      >
        {t('grid.field.relation.relatedDatabasePlaceholder', { defaultValue: 'None' })}
        {!value && <DropdownMenuItemTick />}
      </DropdownMenuItem>
      {options.map((property) => (
        <DropdownMenuItem
          key={property.id}
          className={'w-full'}
          data-testid={`${testIdPrefix}-${property.id}`}
          onSelect={(e) => {
            e.preventDefault();
            onChange(property.id);
          }}
        >
          <FieldDisplay fieldId={property.id} className='min-w-0 flex-1' title={property.name} />
          {value === property.id && <DropdownMenuItemTick />}
        </DropdownMenuItem>
      ))}
    </>
  );

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid='timeline-settings-trigger'>
        <TimelineIcon />
        {t('timeline.settings.name', { defaultValue: 'Timeline settings' })}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className={'appflowy-scroller max-h-[70vh] max-w-[240px] overflow-y-auto'}>
          <DropdownMenuLabel>
            {t('timeline.settings.layoutDateField', { defaultValue: 'Timeline by' })}
          </DropdownMenuLabel>
          {dateProperties.map((property) => (
            <DropdownMenuItem
              key={property.id}
              className={'w-full'}
              data-testid={`timeline-date-field-${property.id}`}
              onSelect={(e) => {
                e.preventDefault();
                updateSetting({ fieldId: property.id });
              }}
            >
              <FieldDisplay fieldId={property.id} className='min-w-0 flex-1' title={property.name} />
              {setting.fieldId === property.id && <DropdownMenuItemTick />}
            </DropdownMenuItem>
          ))}

          <DropdownMenuSeparator />

          {renderOptionalField(
            t('timeline.settings.endDateField', { defaultValue: 'End date' }),
            'timeline-end-field',
            endDateProperties,
            setting.endFieldId,
            (endFieldId) => updateSetting({ endFieldId })
          )}

          <DropdownMenuSeparator />

          <DropdownMenuItem
            className={'w-full'}
            data-testid='timeline-show-table'
            onSelect={(e) => {
              e.preventDefault();
              updateSetting({ showTable: !setting.showTable });
            }}
          >
            {t('timeline.settings.showTable', { defaultValue: 'Show table' })}
            <Switch className={'ml-auto'} checked={setting.showTable} />
          </DropdownMenuItem>

          {/* Notion configures the table's columns separately from the bar's properties. */}
          <DropdownMenuSub>
            <DropdownMenuSubTrigger data-testid='timeline-table-properties-trigger'>
              {t('timeline.settings.tableProperties', { defaultValue: 'Table properties' })}
              <span className='ml-auto text-xs text-text-tertiary'>{setting.tableFieldIds.length}</span>
            </DropdownMenuSubTrigger>
            <DropdownMenuPortal>
              <DropdownMenuSubContent className={'appflowy-scroller max-h-[450px] max-w-[240px] overflow-y-auto'}>
                {tableProperties.map((property) => {
                  const shown = setting.tableFieldIds.includes(property.id);

                  return (
                    <DropdownMenuItem
                      key={property.id}
                      className={'w-full'}
                      data-testid={`timeline-table-field-${property.id}`}
                      onSelect={(e) => {
                        e.preventDefault();
                        updateSetting({
                          tableFieldIds: shown
                            ? setting.tableFieldIds.filter((id) => id !== property.id)
                            : // Keep the view's property order rather than click order.
                              tableProperties
                                .filter(
                                  (candidate) =>
                                    candidate.id === property.id || setting.tableFieldIds.includes(candidate.id)
                                )
                                .map((candidate) => candidate.id),
                        });
                      }}
                    >
                      <FieldDisplay fieldId={property.id} className='min-w-0 flex-1' title={property.name} />
                      <Switch className={'ml-auto'} checked={shown} />
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuSubContent>
            </DropdownMenuPortal>
          </DropdownMenuSub>

          <DropdownMenuSeparator />

          {renderOptionalField(
            t('timeline.settings.dependencies', { defaultValue: 'Dependencies' }),
            'timeline-dependency-field',
            dependencyProperties,
            setting.dependencyFieldId,
            (dependencyFieldId) => updateSetting({ dependencyFieldId })
          )}

          {!setting.dependencyFieldId ? (
            // Notion's one click: creates "Blocked by" / "Blocking" and binds them.
            <DropdownMenuItem
              className={'w-full'}
              data-testid='timeline-set-up-dependencies'
              title={t('timeline.setUpDependenciesHint', {
                defaultValue: 'Adds "Blocked by" and "Blocking" properties and draws arrows between linked items.',
              })}
              onSelect={(e) => {
                e.preventDefault();
                setUpDependencies();
              }}
            >
              <PlusIcon aria-hidden className='h-4 w-4' />
              {t('timeline.setUpDependencies', { defaultValue: 'Set up dependencies' })}
            </DropdownMenuItem>
          ) : null}

          {setting.dependencyFieldId ? (
            <>
              <DropdownMenuLabel>{t('timeline.dependencyDirection', { defaultValue: 'Field lists' })}</DropdownMenuLabel>
              {DIRECTION_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  className={'w-full'}
                  data-testid={`timeline-dependency-direction-${option.value}`}
                  onSelect={(e) => {
                    e.preventDefault();
                    updateSetting({ dependencyDirection: option.value });
                  }}
                >
                  {t(option.labelKey, { defaultValue: option.fallback })}
                  {setting.dependencyDirection === option.value && <DropdownMenuItemTick />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuLabel>
                {t('timeline.settings.shiftDependents', { defaultValue: 'Shift dependents' })}
              </DropdownMenuLabel>
              {SHIFT_OPTIONS.map((option) => (
                <DropdownMenuItem
                  key={option.value}
                  className={'w-full'}
                  data-testid={`timeline-shift-${option.value}`}
                  onSelect={(e) => {
                    e.preventDefault();
                    updateSetting({ dependencyShift: option.value });
                  }}
                >
                  {t(option.labelKey, { defaultValue: option.fallback })}
                  {setting.dependencyShift === option.value && <DropdownMenuItemTick />}
                </DropdownMenuItem>
              ))}
              <DropdownMenuItem
                className={'w-full'}
                data-testid='timeline-avoid-weekends'
                disabled={setting.dependencyShift === TimelineDependencyShift.Never}
                onSelect={(e) => {
                  e.preventDefault();
                  updateSetting({ avoidWeekends: !setting.avoidWeekends });
                }}
              >
                {t('timeline.settings.avoidWeekends', { defaultValue: 'Avoid weekends' })}
                <Switch className={'ml-auto'} checked={setting.avoidWeekends} />
              </DropdownMenuItem>
            </>
          ) : null}

          <DropdownMenuSeparator />

          {renderOptionalField(
            t('timeline.settings.progress', { defaultValue: 'Progress' }),
            'timeline-progress-field',
            progressProperties,
            setting.progressFieldId,
            (progressFieldId) => updateSetting({ progressFieldId })
          )}

          <DropdownMenuSeparator />

          <DropdownMenuLabel>
            {t('timeline.settings.firstDayOfWeek', { defaultValue: 'Start week on' })}
          </DropdownMenuLabel>
          {weekDays.map((day) => (
            <DropdownMenuItem
              key={day.value}
              className={'w-full'}
              data-testid={`timeline-first-day-${day.value}`}
              onSelect={(e) => {
                e.preventDefault();
                updateSetting({ firstDayOfWeek: day.value });
              }}
            >
              {day.name}
              {setting.firstDayOfWeek === day.value && <DropdownMenuItemTick />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export default TimelineLayoutSettings;
