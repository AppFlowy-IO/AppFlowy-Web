import { ViewLayout } from '@/application/types';
import React, { useMemo } from 'react';
import { ReactComponent as BoardSvg } from '@/assets/board.svg';
import { ReactComponent as CalendarSvg } from '@/assets/calendar.svg';
import { ReactComponent as DocumentSvg } from '@/assets/icons/page.svg';
import { ReactComponent as GridSvg } from '@/assets/grid.svg';
import { ReactComponent as ChatSvg } from '@/assets/icons/ai_chat.svg';

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
    return `${iconSize} ${className || ''}`;
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
    default:
      return null;
  }

}

export default ViewIcon;
