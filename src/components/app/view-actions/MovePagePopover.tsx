import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { View, ViewLayout } from '@/application/types';
import { ReactComponent as SelectedIcon } from '@/assets/icons/tick.svg';
import OutlineIcon from '@/components/_shared/outline/OutlineIcon';
import { filterOutByCondition } from '@/components/_shared/outline/utils';
import { useAppOperations, useAppOutline } from '@/components/app/app.hooks';
import SpaceItem from '@/components/app/outline/SpaceItem';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { SearchInput } from '@/components/ui/search-input';
import { Separator } from '@/components/ui/separator';

function MovePagePopover({
  viewId,
  onMoved,
  children,
  popoverContentProps,
  ...props
}: React.ComponentProps<typeof Popover> & {
  viewId: string;
  onMoved?: () => void;
  children: React.ReactNode;
  popoverContentProps?: React.ComponentProps<typeof PopoverContent>;
}) {
  const outline = useAppOutline();

  const [search, setSearch] = React.useState<string>('');
  const { movePage } = useAppOperations();

  const views = useMemo(() => {
    if (!outline) return [];
    return filterOutByCondition(outline, (view) => ({
      remove:
        view.view_id === viewId ||
        view.layout !== ViewLayout.Document ||
        Boolean(search && !view.name.toLowerCase().includes(search.toLowerCase())),
    }));
  }, [outline, search, viewId]);
  const { t } = useTranslation();

  const [expandViewIds, setExpandViewIds] = React.useState<string[]>([]);
  const toggleExpandView = React.useCallback((id: string, isExpanded: boolean) => {
    setExpandViewIds((prev) => {
      return isExpanded ? [...prev, id] : prev.filter((v) => v !== id);
    });
  }, []);

  const [selectedViewId, setSelectedViewId] = React.useState<string | null>(null);

  const handleMoveTo = React.useCallback(async () => {
    if (selectedViewId) {
      try {
        await movePage?.(viewId, selectedViewId);
        onMoved?.();
        setSelectedViewId(null);
        // eslint-disable-next-line
      } catch (e: any) {
        toast.error(e.message);
      }
    }
  }, [movePage, onMoved, selectedViewId, viewId]);

  const renderExtra = React.useCallback(
    ({ view }: { view: View }) => {
      if (view.view_id !== selectedViewId) return null;
      return <SelectedIcon className={'mx-2 text-text-action'} />;
    },
    [selectedViewId]
  );

  return (
    <Popover modal {...props}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        onCloseAutoFocus={(e) => {
          e.preventDefault();
        }}
        {...popoverContentProps}
      >
        <div className={'folder-views flex w-full flex-1 flex-col gap-2 p-2'}>
          <SearchInput
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            autoFocus={true}
            placeholder={t('disclosureAction.movePageTo')}
          />
          <div className={'appflowy-custom-scroller max-h-[400px] flex-1 overflow-y-auto overflow-x-hidden'}>
            {views.map((view) => {
              const isExpanded = expandViewIds.includes(view.view_id);

              return (
                <div key={view.view_id} className={'flex items-start gap-1'}>
                  <div className={'flex h-[30px] items-center'}>
                    <OutlineIcon
                      isExpanded={isExpanded}
                      setIsExpanded={(status) => {
                        toggleExpandView(view.view_id, status);
                      }}
                      level={0}
                    />
                  </div>

                  <SpaceItem
                    view={view}
                    key={view.view_id}
                    width={268}
                    expandIds={expandViewIds}
                    toggleExpand={toggleExpandView}
                    onClickView={(viewId) => {
                      toggleExpandView(viewId, !expandViewIds.includes(viewId));
                      setSelectedViewId(viewId);
                    }}
                    onClickSpace={setSelectedViewId}
                    renderExtra={renderExtra}
                  />
                </div>
              );
            })}
          </div>

          <Separator className={'mb-1'} />
          <div className={'flex items-center justify-end'}>
            <Button onClick={handleMoveTo}>{t('disclosureAction.move')}</Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default MovePagePopover;
