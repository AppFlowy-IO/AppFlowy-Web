import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ChevronRight } from '@/assets/icons/toggle_list.svg';
import PageIcon from '@/components/chat/components/view/page-icon';
import { View } from '@/components/chat/types';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';


export function ViewItem({
  view,
  children,
  onSelectDatabaseView,
}: {
  view: View;
  children?: React.ReactNode;
  onSelectDatabaseView: (viewId: string) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const { t } = useTranslation();

  const name = view.name || t('chat.view.placeholder');

  const ToggleButton = useMemo(() => {
    return view.children.length > 0 ? (
      <Button
        variant={'ghost'}
        className={'!h-4 !min-h-4 !w-4 !min-w-4 !p-0 hover:bg-muted-foreground/10'}
        onClick={(e) => {
          e.stopPropagation();
          setExpanded(!expanded);
        }}
      >
        <ChevronRight className={cn('transform transition-transform', expanded ? 'rotate-90' : 'rotate-0')} />
      </Button>
    ) : (
      <div style={{ width: 16, height: 16 }}></div>
    );
  }, [expanded, view.children.length]);

  return (
    <div className={'flex flex-col'}>
      <div
        onClick={() => onSelectDatabaseView(view.view_id)}
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
      </div>
      {expanded && children}
    </div>
  );
}
