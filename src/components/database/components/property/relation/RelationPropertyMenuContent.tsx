import { TFunction } from 'i18next';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useFieldSelector } from '@/application/database-yjs';
import { RelationLimit } from '@/application/database-yjs/fields/relation/relation.type';
import { YjsDatabaseKey } from '@/application/types';
import { ReactComponent as CountIcon } from '@/assets/icons/count.svg';
import { ReactComponent as DatabaseIcon } from '@/assets/icons/database.svg';
import { ReactComponent as TwoWayRelationIcon } from '@/assets/icons/two_way_relation.svg';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { useRelationData } from '@/components/database/components/property/relation/useRelationData';
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';

import { RelationView } from './RelationView';

const RECIPROCAL_NAME_DEBOUNCE_MS = 300;

function relationLimitLabel(t: TFunction, limit: RelationLimit) {
  return limit === RelationLimit.OneOnly ? t('grid.relation.limitOnePage') : t('grid.relation.limitNoLimit');
}

/**
 * Trailing value on a row, matching desktop's `AFTextMenuItem` trailing slot:
 * `caption.standard` (12px/400) in `textColorScheme.secondary`.
 */
function RowValue({ children }: { children: React.ReactNode }) {
  return <span className='flex min-w-0 items-center gap-1 text-xs text-text-secondary'>{children}</span>;
}

function RelationPropertyMenuContent({ fieldId }: { fieldId: string }) {
  const { t } = useTranslation();
  const { field } = useFieldSelector(fieldId);
  const {
    loading,
    relations,
    relatedViewId,
    selectedView,
    setSelectedView,
    onUpdateDatabaseId,
    onUpdateTypeOption,
    views,
    relationOption,
    relatedDatabaseId,
  } = useRelationData(fieldId);
  const sourceLimit = relationOption?.source_limit ?? RelationLimit.NoLimit;
  const isTwoWay = Boolean(relationOption?.is_two_way);
  const twoWayDisabled = !relatedDatabaseId;
  const fieldName = field?.get(YjsDatabaseKey.name) ?? '';

  // Desktop seeds the reciprocal name from the type option, falling back to the
  // relation field's own name (`_TwoWayRelationPopoverContentState.initState`).
  const [reciprocalName, setReciprocalName] = useState(
    () => relationOption?.reciprocal_field_name || fieldName
  );
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    setReciprocalName(relationOption?.reciprocal_field_name || fieldName);
    // Re-seed only when the persisted value changes, so typing isn't clobbered.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [relationOption?.reciprocal_field_name]);

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  const handleReciprocalNameChange = useCallback(
    (value: string) => {
      setReciprocalName(value);

      if (debounceRef.current) clearTimeout(debounceRef.current);
      // Desktop debounces the write and ignores empty input.
      if (!value) return;

      debounceRef.current = setTimeout(() => {
        void onUpdateTypeOption({ reciprocal_field_name: value });
      }, RECIPROCAL_NAME_DEBOUNCE_MS);
    },
    [onUpdateTypeOption]
  );

  const handleToggleTwoWay = useCallback(() => {
    if (twoWayDisabled) return;

    if (isTwoWay) {
      void onUpdateTypeOption({ is_two_way: false });
      return;
    }

    void onUpdateTypeOption({
      is_two_way: true,
      reciprocal_field_name: relationOption?.reciprocal_field_name || fieldName,
    });
  }, [fieldName, isTwoWay, onUpdateTypeOption, relationOption?.reciprocal_field_name, twoWayDisabled]);

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        {/* Desktop's section header is `caption.standard` — 12px/400. */}
        <DropdownMenuLabel className='font-normal'>{t('grid.relation.relatedDatabasePlaceLabel')}</DropdownMenuLabel>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <DatabaseIcon className='h-5 w-5 shrink-0 text-icon-primary' />
            <span className='flex-1'>{t('grid.relation.dataSource')}</span>
            <RowValue>
              {loading ? (
                <Progress variant={'primary'} />
              ) : (
                <>
                  {selectedView ? (
                    <PageIcon
                      className='flex !h-5 !w-5 shrink-0 items-center justify-center text-xl'
                      iconSize={20}
                      view={selectedView}
                    />
                  ) : null}
                  <span className='truncate'>
                    {selectedView?.name || t('grid.relation.relatedDatabasePlaceholder')}
                  </span>
                </>
              )}
            </RowValue>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className={'appflowy-scroller max-h-[600px] max-w-[320px] overflow-y-auto'}>
              {views.map((view) => (
                <DropdownMenuItem
                  key={view.view_id}
                  onSelect={() => {
                    setSelectedView(view);
                    const databaseId = Object.entries(relations || []).find(([, id]) => id === view.view_id)?.[0];

                    if (databaseId) {
                      void onUpdateDatabaseId(databaseId);
                    }
                  }}
                >
                  <RelationView view={view} />

                  {view.view_id === relatedViewId && <DropdownMenuItemTick />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            <CountIcon className='h-5 w-5 shrink-0 text-icon-primary' />
            <span className='flex-1'>{t('grid.relation.limit')}</span>
            <RowValue>
              <span className='truncate'>{relationLimitLabel(t, sourceLimit)}</span>
            </RowValue>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className={'w-[240px]'}>
              {[RelationLimit.NoLimit, RelationLimit.OneOnly].map((limit) => (
                <DropdownMenuItem
                  key={limit}
                  onSelect={() => {
                    void onUpdateTypeOption({ source_limit: limit });
                  }}
                >
                  <span className='flex-1'>{relationLimitLabel(t, limit)}</span>
                  {sourceLimit === limit && <DropdownMenuItemTick />}
                </DropdownMenuItem>
              ))}
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>

        <DropdownMenuSub>
          <DropdownMenuSubTrigger disabled={twoWayDisabled}>
            <TwoWayRelationIcon className='h-5 w-5 shrink-0 text-icon-primary' />
            <span className='flex-1'>{t('grid.relation.twoWayRelation')}</span>
            <RowValue>
              <span className='truncate'>{isTwoWay ? t('grid.relation.on') : t('grid.relation.off')}</span>
            </RowValue>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            {/* `_TwoWayRelationPopoverContent`: 320 wide, unpadded shell. */}
            <DropdownMenuSubContent className={'w-[320px] p-0'}>
              <div className={'px-2 pt-2'}>
                <div
                  className={'flex min-h-[32px] cursor-pointer items-center gap-[10px] rounded-300 px-2 py-1 text-sm'}
                  onClick={handleToggleTwoWay}
                >
                  <span className='flex-1'>{t('grid.relation.enable')}</span>
                  <Switch
                    checked={isTwoWay}
                    data-testid='relation-two-way-enable'
                    onCheckedChange={handleToggleTwoWay}
                  />
                </div>
              </div>
              <DropdownMenuSeparator />
              <div className={'px-4 pb-4 pt-1'}>
                <div className={'mb-1 text-xs font-medium text-text-secondary'}>
                  {t('grid.relation.propertyNameInRelatedDatabase')}
                </div>
                <Input
                  data-testid='relation-reciprocal-name'
                  value={reciprocalName}
                  disabled={!isTwoWay}
                  onChange={(event) => handleReciprocalNameChange(event.target.value)}
                  onKeyDown={(event) => event.stopPropagation()}
                />
              </div>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
      </DropdownMenuGroup>
    </>
  );
}

export default RelationPropertyMenuContent;
