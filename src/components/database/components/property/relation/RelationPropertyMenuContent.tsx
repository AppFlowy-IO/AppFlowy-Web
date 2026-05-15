
import { useEffect, useState } from 'react';
import { TFunction } from 'i18next';
import { useTranslation } from 'react-i18next';

import { useDatabaseContext } from '@/application/database-yjs';
import { RelationLimit } from '@/application/database-yjs/fields/relation/relation.type';
import { useRelationData } from '@/components/database/components/property/relation/useRelationData';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuItemTick,
} from '@/components/ui/dropdown-menu';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';

import { RelationView } from './RelationView';

function relationLimitLabel(t: TFunction, limit: RelationLimit) {
  return limit === RelationLimit.OneOnly
    ? t('grid.relation.limitOnePage', { defaultValue: 'One page' })
    : t('grid.relation.limitNoLimit', { defaultValue: 'No limit' });
}

function RelationPropertyMenuContent({ fieldId }: { fieldId: string }) {
  const { t } = useTranslation();
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
  } =
    useRelationData(fieldId);
  const { databasePageId, loadViewMeta } = useDatabaseContext();
  const [sourceDatabaseName, setSourceDatabaseName] = useState<string>('');
  const [disableTwoWayConfirmOpen, setDisableTwoWayConfirmOpen] = useState(false);
  const sourceLimit = relationOption?.source_limit ?? RelationLimit.NoLimit;
  const twoWayDisabled = !relatedDatabaseId;

  useEffect(() => {
    if (!loadViewMeta || !databasePageId) return;

    let cancelled = false;

    void loadViewMeta(databasePageId)
      .then((meta) => {
        if (cancelled) return;
        setSourceDatabaseName(meta?.name ?? '');
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [databasePageId, loadViewMeta]);

  return (
    <>
      <DropdownMenuSeparator />
      <DropdownMenuGroup>
        <DropdownMenuLabel>{t('grid.relation.relatedDatabasePlaceLabel')}</DropdownMenuLabel>
        <DropdownMenuSub>
          <DropdownMenuSubTrigger>
            {loading ? (
              <Progress variant={'primary'} />
            ) : selectedView ? (
              <RelationView view={selectedView} />
            ) : (
              t('grid.relation.relatedDatabasePlaceholder')
            )}
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent className={'appflowy-scroller max-h-[450px] max-w-[240px] overflow-y-auto'}>
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
            <span className="flex-1">{t('grid.relation.limit', { defaultValue: 'Limit' })}</span>
            <span className="text-text-tertiary">{relationLimitLabel(t, sourceLimit)}</span>
          </DropdownMenuSubTrigger>
          <DropdownMenuPortal>
            <DropdownMenuSubContent>
              <DropdownMenuRadioGroup
                value={String(sourceLimit)}
                onValueChange={(value) => {
                  void onUpdateTypeOption({ source_limit: Number(value) as RelationLimit });
                }}
              >
                {[RelationLimit.NoLimit, RelationLimit.OneOnly].map((limit) => (
                  <DropdownMenuRadioItem key={limit} value={String(limit)}>
                    {relationLimitLabel(t, limit)}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuSubContent>
          </DropdownMenuPortal>
        </DropdownMenuSub>
        <DropdownMenuItem
          disabled={twoWayDisabled}
          onSelect={(event) => {
            event.preventDefault();
            if (twoWayDisabled) return;

            if (relationOption?.is_two_way) {
              setDisableTwoWayConfirmOpen(true);
              return;
            }

            void onUpdateTypeOption({
              is_two_way: true,
              // The reciprocal property is created in the related database, so it
              // should be named after the SOURCE database (the one the user is
              // currently viewing) — that matches RelationCreationDialog and is
              // what users expect to see when navigating into the related db.
              reciprocal_field_name: sourceDatabaseName || t('grid.field.relationFieldName'),
            });
          }}
        >
          <span className="flex-1">{t('grid.relation.twoWayRelation', { defaultValue: 'Two-way relation' })}</span>
          <Switch checked={Boolean(relationOption?.is_two_way)} disabled={twoWayDisabled} />
        </DropdownMenuItem>
      </DropdownMenuGroup>
      <AlertDialog open={disableTwoWayConfirmOpen} onOpenChange={setDisableTwoWayConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('grid.relation.disableTwoWayRelationTitle', { defaultValue: 'Disable two-way relation?' })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('grid.relation.disableTwoWayRelationDescription', {
                defaultValue: 'The reciprocal property will be removed from the related database.',
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('button.cancel', { defaultValue: 'Cancel' })}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                void onUpdateTypeOption({ is_two_way: false });
              }}
            >
              {t('button.confirm', { defaultValue: 'Confirm' })}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

export default RelationPropertyMenuContent;
