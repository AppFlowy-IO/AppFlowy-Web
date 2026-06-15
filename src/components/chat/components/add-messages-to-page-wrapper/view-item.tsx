import { PlusIcon } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as AddPageIcon } from '@/assets/icons/add_to_page.svg';
import { ReactComponent as ChevronRight } from '@/assets/icons/toggle_list.svg';
import PageIcon from '@/components/chat/components/view/page-icon';
import { View } from '@/components/chat/types';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';



export function ViewItem({
  view,
  children,
  onCreateViewWithContent,
  onInsertContentToView,
}: {
  view: View;
  children?: React.ReactNode;
  onCreateViewWithContent: (parentViewId: string) => void;
  onInsertContentToView: (viewId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();

  const [isHovering, setIsHovering] = useState(false);
  const name = view.name || t('chat.view.placeholder');

  const ToggleButton = useMemo(() => {
    return view.children.length > 0 ? (
      <Button variant={'ghost'} className={'!h-4 !min-h-4 !w-4 !min-w-4 !p-0 hover:bg-muted-foreground/10'}>
        <ChevronRight className={cn('transform transition-transform', expanded ? 'rotate-90' : 'rotate-0')} />
      </Button>
    ) : (
      <div style={{ width: 16, height: 16 }}></div>
    );
  }, [expanded, view.children.length]);

  return (
    <div className={'flex flex-col'}>
      <div
        onMouseEnter={() => setIsHovering(true)}
        onMouseLeave={() => setIsHovering(false)}
        onClick={() => setExpanded(!expanded)}
        className={
          'flex h-[28px] w-full cursor-pointer select-none items-center justify-between gap-2 rounded-[8px] px-1.5 text-sm hover:bg-muted'
        }
      >
        <div className={'flex w-full items-center gap-2 overflow-hidden'}>
          <div className={'flex items-center gap-0.5'}>
            {ToggleButton}
            <PageIcon view={view} />
          </div>
          <TooltipProvider>
            <Tooltip disableHoverableContent={true}>
              <TooltipTrigger asChild>
                <span className={'flex-1 truncate'}>{name}</span>
              </TooltipTrigger>
              <TooltipContent>{name}</TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>
        {isHovering && (
          <div
            onClick={(e) => {
              e.stopPropagation();
            }}
            className={'flex items-center gap-1'}
          >
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => onInsertContentToView(view.view_id)}
                    variant={'ghost'}
                    className={'!h-5 !w-5 rounded-md !p-0 hover:bg-muted-foreground/10'}
                  >
                    <AddPageIcon className={'h-5 w-5'} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('chat.button.addToPage')}</TooltipContent>
              </Tooltip>

              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onClick={() => {
                      onCreateViewWithContent(view.view_id);
                    }}
                    variant={'ghost'}
                    className={'!h-5 !w-5 rounded-md !p-0 hover:bg-muted-foreground/10'}
                  >
                    <PlusIcon className={'h-5 w-5'} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t('chat.addMessageToPage.createNewPage')}</TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
      </div>
      {expanded && children}
    </div>
  );
}
