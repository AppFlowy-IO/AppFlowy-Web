import dayjs from 'dayjs';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import {
  FieldType,
  parseRelationTypeOption,
  useDatabase,
  useDatabaseFields,
  usePropertiesSelector,
  useTimelineLayoutSetting,
} from '@/application/database-yjs';
import { useUpdateTimelineSetting } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
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

function TimelineLayoutSettings() {
  const { t } = useTranslation();
  const setting = useTimelineLayoutSetting();
  const updateSetting = useUpdateTimelineSetting();
  const database = useDatabase();
  const fields = useDatabaseFields();
  const databaseId = database?.get(YjsDatabaseKey.id);

  const { properties: allProperties } = usePropertiesSelector(false);
  const dateProperties = useMemo(
    () => allProperties.filter((property) => DATE_FIELD_TYPES.includes(property.type)),
    [allProperties]
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
          <FieldDisplay fieldId={property.id} />
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
          <DropdownMenuLabel>{t('timeline.settings.layoutDateField', { defaultValue: 'Timeline by' })}</DropdownMenuLabel>
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
              <FieldDisplay fieldId={property.id} />
              {setting.fieldId === property.id && <DropdownMenuItemTick />}
            </DropdownMenuItem>
          ))}

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

          <DropdownMenuSeparator />

          {renderOptionalField(
            t('timeline.settings.dependencies', { defaultValue: 'Dependencies' }),
            'timeline-dependency-field',
            dependencyProperties,
            setting.dependencyFieldId,
            (dependencyFieldId) => updateSetting({ dependencyFieldId })
          )}

          <DropdownMenuSeparator />

          {renderOptionalField(
            t('timeline.settings.progress', { defaultValue: 'Progress' }),
            'timeline-progress-field',
            progressProperties,
            setting.progressFieldId,
            (progressFieldId) => updateSetting({ progressFieldId })
          )}

          <DropdownMenuSeparator />

          <DropdownMenuLabel>{t('timeline.settings.firstDayOfWeek', { defaultValue: 'Start week on' })}</DropdownMenuLabel>
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
