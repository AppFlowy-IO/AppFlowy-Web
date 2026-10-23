import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, useFieldSelector, usePropertiesSelector, useReadOnly } from '@/application/database-yjs';
import { BOARD_GROUPABLE_FIELD_TYPES } from '@/application/database-yjs/board-default-group';
import { useCreateBoardGroupingFieldDispatch, useGroupByFieldDispatch } from '@/application/database-yjs/dispatch';
import { YjsDatabaseKey } from '@/application/types';
import { FieldDisplay } from '@/components/database/components/field';
import { Button } from '@/components/ui/button';
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from '@/components/ui/dropdown-menu';

/**
 * Shown instead of a Board that has nothing it can draw: no grouping, a deleted
 * grouping property, or a grouping by a property type the web Board cannot
 * draw yet. Editors can regroup the Board from here.
 */
export function BoardNoGroup({ fieldId }: { fieldId?: string | null }) {
  const { t } = useTranslation();
  const readOnly = useReadOnly();
  const { field } = useFieldSelector(fieldId ?? '');
  const fieldType = Number(field?.get(YjsDatabaseKey.type)) as FieldType;
  const unsupportedFieldName =
    field && !BOARD_GROUPABLE_FIELD_TYPES.includes(fieldType) ? String(field.get(YjsDatabaseKey.name) ?? '') : undefined;
  const groupBy = useGroupByFieldDispatch();
  const createGroupingField = useCreateBoardGroupingFieldDispatch();
  // Desktop offers every groupable field, hidden ones included.
  const { properties: allProperties } = usePropertiesSelector(false);
  const properties = useMemo(
    () => allProperties.filter((property) => BOARD_GROUPABLE_FIELD_TYPES.includes(property.type)),
    [allProperties]
  );

  return (
    <div
      data-testid='board-no-group'
      className={'mt-[10%] flex h-full w-full flex-col items-center gap-2 px-6 text-center text-text-secondary'}
    >
      <div className={'text-sm font-medium'}>{t('board.noGroup')}</div>
      <div data-testid='board-no-group-description' className={'max-w-[420px] text-xs'}>
        {unsupportedFieldName === undefined
          ? t('board.noGroupDesc')
          : t('board.noGroupUnsupported', { name: unsupportedFieldName })}
      </div>
      {!readOnly && (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button data-testid='board-no-group-group-by' variant={'outline'} size={'sm'} className={'mt-2'}>
              {t('board.groupBy')}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent data-testid='board-no-group-menu' align={'center'} className={'!min-w-[200px]'}>
            {properties.map((property) => (
              <DropdownMenuItem
                data-testid={`board-no-group-field-${property.id}`}
                key={property.id}
                onSelect={() => groupBy(property.id)}
              >
                <FieldDisplay className={'min-w-0 flex-1'} fieldId={property.id} />
              </DropdownMenuItem>
            ))}
            {properties.length === 0 && (
              <DropdownMenuItem data-testid='board-no-group-create-status' onSelect={() => createGroupingField()}>
                {t('board.newStatusProperty')}
              </DropdownMenuItem>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      )}
    </div>
  );
}

export default BoardNoGroup;
