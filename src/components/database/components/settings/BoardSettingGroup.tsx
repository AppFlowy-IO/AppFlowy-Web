import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useBoardLayoutSettings, useFieldType, usePropertiesSelector } from '@/application/database-yjs';
import { useGroupByFieldDispatch, useToggleHideUnGrouped } from '@/application/database-yjs/dispatch';
import { ReactComponent as GroupIcon } from '@/assets/icons/group.svg';
import { FieldDisplay } from '@/components/database/components/field';
import {
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuItemTick,
  DropdownMenuSeparator,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

function BoardSettingGroup() {
  const { t } = useTranslation();
  const { hideUnGroup, fieldId } = useBoardLayoutSettings();
  const fieldType = useFieldType(fieldId || '');
  const toggle = useToggleHideUnGrouped();
  const groupBy = useGroupByFieldDispatch();

  const { properties: allProperties } = usePropertiesSelector(true);
  const properties = useMemo(() => {
    return allProperties.filter((property) => {
      const type = property.type;

      return [
        FieldType.SingleSelect,
        FieldType.MultiSelect,
        FieldType.Checkbox,
        // FieldType.DateTime,
        // FieldType.LastEditedTime,
        // FieldType.CreatedTime,
      ].includes(type);
    });
  }, [allProperties]);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger>
        <GroupIcon />
        {t('grid.settings.group')}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent className={'appflowy-scroller max-w-[240px] overflow-y-auto'}>
          {fieldType !== FieldType.Checkbox && (
            <>
              <DropdownMenuItem
                className={'w-full'}
                onSelect={(e) => {
                  e.preventDefault();
                  toggle(!hideUnGroup);
                }}
              >
                {t('board.showUngrouped')}
                <Switch className={'ml-auto'} checked={!hideUnGroup} />
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          <DropdownMenuLabel>{t('board.groupBy')}</DropdownMenuLabel>
          {properties.map((property) => (
            <DropdownMenuItem
              key={property.id}
              className={'w-full'}
              onSelect={(e) => {
                e.preventDefault();
                groupBy(property.id);
              }}
            >
              <FieldDisplay fieldId={property.id} />
              {fieldId === property.id && <DropdownMenuItemTick />}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export default BoardSettingGroup;
