import { useMemo } from 'react';

import { ViewLayout } from '@/application/types';
import { ReactComponent as ChatSvg } from '@/assets/icons/ai_chat.svg';
import { ReactComponent as BoardSvg } from '@/assets/icons/board.svg';
import { ReactComponent as CalendarSvg } from '@/assets/icons/calendar.svg';
import { ReactComponent as ChartSvg } from '@/assets/icons/chart.svg';
import { ReactComponent as GallerySvg } from '@/assets/icons/gallery.svg';
import { ReactComponent as GridSvg } from '@/assets/icons/grid.svg';
import { ReactComponent as ListSvg } from '@/assets/icons/list.svg';
import { ReactComponent as DocumentSvg } from '@/assets/icons/page.svg';

export function ViewIcon ({ layout, size, className }: {
  layout: ViewLayout;
  size: number | 'small' | 'medium' | 'large' | 'unset',
  className?: string;
}) {
  const iconSize = useMemo(() => {
    if (size === 'small') {
      return 'h-5 w-5';
    }

    if (size === 'medium') {
      return 'h-6 w-6';
    }

    if (size === 'large') {
      return 'h-8 w-8';
    }

    if (size === 'unset') {
      return '';
    }

    return `h-[${size}px] w-[${size}px]`;
  }, [size]);

  const iconClassName = useMemo(() => {
    return className ? `${iconSize} ${className}` : iconSize;
  }, [iconSize, className]);

  switch (layout) {
    case ViewLayout.AIChat:
      return <ChatSvg className={iconClassName} />;
    case ViewLayout.Grid:
      return <GridSvg className={iconClassName} />;
    case ViewLayout.Board:
      return <BoardSvg className={iconClassName} />;
    case ViewLayout.Calendar:
      return <CalendarSvg className={iconClassName} />;
    case ViewLayout.Document:
      return <DocumentSvg className={iconClassName} />;
    case ViewLayout.Chart:
      return <ChartSvg className={iconClassName} />;
    case ViewLayout.List:
      return <ListSvg className={iconClassName} />;
    case ViewLayout.Gallery:
      return <GallerySvg className={iconClassName} />;
    default:
      return null;
  }

}

export default ViewIcon;
