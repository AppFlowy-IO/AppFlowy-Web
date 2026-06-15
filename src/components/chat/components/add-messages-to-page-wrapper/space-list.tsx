import { PlusIcon } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import LoadingDots from '@/components/chat/components/ui/loading-dots';
import SpaceItem from '@/components/chat/components/view/space-item';
import { searchViews } from '@/components/chat/lib/views';
import { useViewLoader } from '@/components/chat/provider/view-loader-provider';
import { View } from '@/components/chat/types';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';

import ViewList from '../add-messages-to-page-wrapper/view-list';

export function SpaceList({
  searchValue,
  onCreateViewWithContent,
  onInsertContentToView,
}: {
  searchValue: string;
  onCreateViewWithContent: (parentViewId: string) => void;
  onInsertContentToView: (viewId: string) => void;
}) {
  const { t } = useTranslation();

  const { fetchViews, viewsLoading } = useViewLoader();

  const [folder, setFolder] = useState<View | null>(null);

  useEffect(() => {
    void (async () => {
      const data = await fetchViews();

      if (!data) return;
      setFolder(data);
    })();
  }, [fetchViews]);

  const filteredSpaces = useMemo(() => {
    const spaces = folder?.children.filter((view) => view.extra?.is_space);

    return searchViews(spaces || [], searchValue);
  }, [folder, searchValue]);

  if (viewsLoading) {
    return (
      <div className={'flex h-full w-full  items-center justify-center py-10'}>
        <LoadingDots />
      </div>
    );
  }

  if (!filteredSpaces || filteredSpaces.length === 0) {
    return (
      <div className={'flex h-full w-full items-center justify-center py-10 opacity-60'}>
        {t('chat.search.noSpacesFound')}
      </div>
    );
  }

  return (
    <div className={'flex h-full w-full flex-col gap-1'}>
      {filteredSpaces.map((view: View) => {
        return (
          <SpaceItem
            key={view.view_id}
            view={view}
            extraNode={
              <TooltipProvider>
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCreateViewWithContent(view.view_id);
                      }}
                      variant={'ghost'}
                      className={'!h-5 !w-5 rounded-md !p-0 hover:bg-muted-foreground/10'}
                    >
                      <PlusIcon className={'h-4 w-4'} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent>{t('chat.addMessageToPage.createNewPage')}</TooltipContent>
                </Tooltip>
              </TooltipProvider>
            }
          >
            <ViewList
              onCreateViewWithContent={onCreateViewWithContent}
              onInsertContentToView={onInsertContentToView}
              item={view}
            />
          </SpaceItem>
        );
      })}
    </div>
  );
}