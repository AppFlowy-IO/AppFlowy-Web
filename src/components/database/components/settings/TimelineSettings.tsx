import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useDatabase, usePropertiesSelector } from '@/application/database-yjs';
import {
  useClearGroupByFieldDispatch,
  useGroupByFieldDispatch,
  useSetAllGridGroupsVisibilityDispatch,
  useSetGridGroupVisibilityDispatch,
  useUpdateDateGroupConditionDispatch,
  useUpdateNumberGroupConfigurationDispatch,
} from '@/application/database-yjs/dispatch';
import { useTimelineSettings, useUpdateTimelineSettings } from '@/application/database-yjs/timeline-layout';
import { DatabaseViewLayout, YjsDatabaseKey } from '@/application/types';
import { FieldDisplay } from '@/components/database/components/field';
import { DatabaseSettingGroup } from '@/components/database/components/settings/GridSettingGroup';
import Layout from '@/components/database/components/settings/Layout';
import { useTimelineGrouping } from '@/components/database/timeline/TimelineGroupingContext';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';

export function TimelineOptions() {
  const { t } = useTranslation();
  const settings = useTimelineSettings();
  const update = useUpdateTimelineSettings();
  const database = useDatabase();
  const { properties } = usePropertiesSelector(false);
  const dates = properties.filter((field) =>
    [FieldType.DateTime, FieldType.CreatedTime, FieldType.LastEditedTime].includes(field.type)
  );
  const grouping = useTimelineGrouping();
  const groupBy = useGroupByFieldDispatch();
  const clearGrouping = useClearGroupByFieldDispatch();
  const setVisibility = useSetGridGroupVisibilityDispatch(grouping.groupId, grouping.fieldId);
  const setAllVisibility = useSetAllGridGroupsVisibilityDispatch(grouping.groupId, grouping.fieldId);
  const updateDateCondition = useUpdateDateGroupConditionDispatch();
  const updateNumberConfiguration = useUpdateNumberGroupConfigurationDispatch();

  return (
    <>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger data-testid='timeline-date-field-settings'>
          {t('timeline.dateProperty')}
        </DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent>
            <DropdownMenuLabel>{t('timeline.startDate')}</DropdownMenuLabel>
            {dates.map((field) => (
              <DropdownMenuItem
                key={field.id}
                onSelect={() =>
                  update({ fieldId: field.id, endFieldId: settings.endFieldId === field.id ? '' : settings.endFieldId })
                }
              >
                <FieldDisplay fieldId={field.id} />
                {field.id === settings.fieldId && <DropdownMenuItemTick />}
              </DropdownMenuItem>
            ))}
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
      <DropdownMenuSub>
        <DropdownMenuSubTrigger>{t('timeline.endDate')}</DropdownMenuSubTrigger>
        <DropdownMenuPortal>
          <DropdownMenuSubContent>
            <DropdownMenuItem onSelect={() => update({ endFieldId: '' })}>
              {t('timeline.sameProperty')}
              {!settings.endFieldId && <DropdownMenuItemTick />}
            </DropdownMenuItem>
            {dates
              .filter((field) => field.id !== settings.fieldId)
              .map((field) => (
                <DropdownMenuItem key={field.id} onSelect={() => update({ endFieldId: field.id })}>
                  <FieldDisplay fieldId={field.id} />
                  {field.id === settings.endFieldId && <DropdownMenuItemTick />}
                </DropdownMenuItem>
              ))}
          </DropdownMenuSubContent>
        </DropdownMenuPortal>
      </DropdownMenuSub>
      <DropdownMenuSeparator />
      <DropdownMenuItem
        role='menuitemcheckbox'
        aria-checked={settings.showTable}
        onSelect={(event) => {
          event.preventDefault();
          update({ showTable: !settings.showTable });
        }}
      >
        {t('timeline.showTable')}
        {settings.showTable && <DropdownMenuItemTick />}
      </DropdownMenuItem>
      {(['tableFieldIds', 'barFieldIds'] as const).map((key) => (
        <DropdownMenuSub key={key}>
          <DropdownMenuSubTrigger>
            {t(key === 'tableFieldIds' ? 'timeline.tableProperties' : 'timeline.barProperties')}
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className='max-h-80 overflow-y-auto'>
              {properties
                .filter((field) => !database.get(YjsDatabaseKey.fields)?.get(field.id)?.get(YjsDatabaseKey.is_primary))
                .map((field) => (
                  <DropdownMenuItem
                    key={field.id}
                    role='menuitemcheckbox'
                    aria-checked={settings[key].includes(field.id)}
                    onSelect={(event) => {
                      event.preventDefault();
                      update({
                        [key]: settings[key].includes(field.id)
                          ? settings[key].filter((id) => id !== field.id)
                          : [...settings[key], field.id],
                      });
                    }}
                  >
                    <FieldDisplay fieldId={field.id} />
                    {settings[key].includes(field.id) && <DropdownMenuItemTick />}
                  </DropdownMenuItem>
                ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      ))}
      <DropdownMenuSeparator />
      <DatabaseSettingGroup
        grouping={grouping}
        groupBy={groupBy}
        clearGrouping={clearGrouping}
        toggleHideEmpty={(hideEmptyGroups) => update({ hideEmptyGroups })}
        setVisibility={setVisibility}
        setAllVisibility={setAllVisibility}
        updateDateCondition={updateDateCondition}
        updateNumberConfiguration={updateNumberConfiguration}
        testIdPrefix='timeline'
      />
    </>
  );
}

export default function TimelineSettings({ children }: { children: ReactNode }) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <div className='h-7 w-7'>{children}</div>
      </DropdownMenuTrigger>
      <DropdownMenuContent align='end' onCloseAutoFocus={(event) => event.preventDefault()}>
        <TimelineOptions />
        <DropdownMenuSeparator />
        <Layout currentLayout={DatabaseViewLayout.Timeline} />
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
