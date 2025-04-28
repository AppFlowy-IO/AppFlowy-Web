import { View, ViewLayout } from '@/application/types';
import { Separator } from '@/components/ui/separator';
import { toast } from 'sonner';
import { filterOutByCondition } from '@/components/_shared/outline/utils';
import { useAppHandlers, useAppOutline } from '@/components/app/app.hooks';
import SpaceItem from '@/components/app/outline/SpaceItem';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import OutlineIcon from '@/components/_shared/outline/OutlineIcon';
import { ReactComponent as SelectedIcon } from '@/assets/icons/tick.svg';
import {
  Popover,
  PopoverTrigger,
  PopoverContent,
} from '@/components/ui/popover';

import { Button } from '@/components/ui/button';
import { SearchInput } from '@/components/ui/search-input';

function MovePagePopover ({
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
  const {
    movePage,
  } = useAppHandlers();

  const views = useMemo(() => {
    if (!outline) return [];
    return filterOutByCondition(outline, (view) => ({
      remove: view.view_id === viewId || view.layout !== ViewLayout.Document || Boolean(search && !view.name.toLowerCase().includes(search.toLowerCase())),
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

  const renderExtra = React.useCallback(({ view }: { view: View }) => {
    if (view.view_id !== selectedViewId) return null;
    return <SelectedIcon className={'text-fill-default mx-2'} />;
  }, [selectedViewId]);

  return (
    <Popover modal {...props}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        onCloseAutoFocus={e => {
          e.preventDefault();
        }} {...popoverContentProps}>
        <div className={'flex folder-views w-full flex-1 flex-col gap-2 p-2'}>
          <SearchInput
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
            }}
            autoFocus={true}
            placeholder={t('disclosureAction.movePageTo')}
          />
          <div className={'flex-1 max-h-[400px] overflow-x-hidden overflow-y-auto appflowy-custom-scroller'}>
            {views.map((view) => {
              const isExpanded = expandViewIds.includes(view.view_id);

              return <div
                key={view.view_id}
                className={'flex items-start gap-1'}
              >
                <div className={'h-[30px] flex items-center'}>
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
                  onClickView={viewId => {
                    toggleExpandView(viewId, !expandViewIds.includes(viewId));
                    setSelectedViewId(viewId);
                  }}
                  onClickSpace={setSelectedViewId}
                  renderExtra={renderExtra}
                /></div>;
            })}
          </div>

          <Separator className={'mb-1'} />
          <div className={'flex items-center justify-end'}>
            <Button
              onClick={handleMoveTo}
            >
              {t('disclosureAction.move')}
            </Button>
          </div>
        </div>
      </PopoverContent>

    </Popover>
  );
}

export default MovePagePopover;