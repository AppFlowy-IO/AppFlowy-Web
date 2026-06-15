import { CheckSquare, Minus, Square } from 'lucide-react';
import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ChevronRight } from '@/assets/icons/toggle_list.svg';
import PageIcon from '@/components/chat/components/view/page-icon';
import { View } from '@/components/chat/types';
import { CheckStatus } from '@/components/chat/types/checkbox';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';


export function ViewItem({
  view,
  children,
  getCheckStatus,
  onToggle,
  getInitialExpand,
}: {
  view: View;
  children?: React.ReactNode;
  getCheckStatus: (view: View) => CheckStatus;
  onToggle: (view: View) => void;
  getInitialExpand: (viewId: string) => boolean;
}) {
  const [expanded, setExpanded] = useState(() => {
    return getInitialExpand(view.view_id);
  });
  const { t } = useTranslation();

  const name = view.name || t('chat.view.placeholder');
  const checkStatus = getCheckStatus(view);
  const CheckboxIcon = useMemo(() => {
    switch (checkStatus) {
      case CheckStatus.Checked:
        return <CheckSquare className='h-4 w-4 text-primary' />;
      case CheckStatus.Indeterminate:
        return (
          <Square className='h-4 w-4  text-primary'>
            <Minus className='h-3 w-3' />
          </Square>
        );
      default:
        return <Square className='h-4 w-4' />;
    }
  }, [checkStatus]);

  const ToggleButton = useMemo(() => {
    return view.children.length > 0 ? (
      <Button
        variant={'ghost'}
        size={'icon'}
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((prev) => !prev);
        }}
        className={'!h-4 !min-h-4 !w-4 !min-w-4 hover:bg-muted-foreground/10'}
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
        onClick={(e) => {
          e.stopPropagation();
          onToggle(view);
        }}
        className={
          'flex h-[28px] w-full cursor-pointer select-none items-center justify-between gap-2 rounded-[8px] px-1.5 text-sm hover:bg-muted'
        }
      >
        <div className={'flex w-full items-center gap-2 overflow-hidden'}>
          <div className={'flex cursor-pointer items-center gap-0.5'}>
            {ToggleButton}
            <Button variant='ghost' size='sm' className='mr-1 h-4 w-4 p-0'>
              {CheckboxIcon}
            </Button>
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
