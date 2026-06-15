import DOMPurify from 'dompurify';
import { useEffect, useMemo, useState } from 'react';

import { ReactComponent as BoardIcon } from '@/assets/icons/board.svg';
import { ReactComponent as CalendarIcon } from '@/assets/icons/calendar.svg';
import { ReactComponent as GridIcon } from '@/assets/icons/grid.svg';
import { ReactComponent as DocIcon } from '@/assets/icons/page.svg';
import { getIcon, renderColor } from '@/components/chat/lib/utils';
import { View, ViewIconType, ViewLayout } from '@/components/chat/types';
import { cn } from '@/lib/utils';

function PageIcon({ view }: {
  view: View;
}) {
  const icon = view.icon;

  const [iconSvg, setIconSvg] = useState<string | null>(null);
  const [iconColor, setIconColor] = useState<string | null>(null);
  const isEmoji = icon?.ty === ViewIconType.Emoji;

  useEffect(() => {
    if(isEmoji || !icon) return;
    void (async() => {

      const iconValue = icon.value;

      const iconJson = iconValue ? JSON.parse(iconValue) : null;

      if(iconJson) {
        const svg = await getIcon(`${iconJson.groupName}/${iconJson.iconName}`);

        if(svg) {
          setIconSvg(svg);
        }

        setIconColor(iconJson.color);
      }
    })();
  }, [icon, isEmoji, view.extra]);

  const customIcon = useMemo(() => {
    const cleanSvg = iconSvg ? DOMPurify.sanitize(iconSvg.replace('black', iconColor ? renderColor(iconColor) : 'black').replace('<svg', '<svg width="100%" height="100%"'), {
      USE_PROFILES: { svg: true, svgFilters: true },
    }) : '';

    return <span
      className={cn('flex w-5 h-5 rounded-md items-center justify-center')}
    ><span
      dangerouslySetInnerHTML={{
        __html: cleanSvg,
      }}
    /></span>;
  }, [iconColor, iconSvg]);

  if (!icon || !icon.value) {
    switch (view.layout) {
      case ViewLayout.Board:
        return <BoardIcon className='h-5 w-5' />;
      case ViewLayout.Calendar:
        return <CalendarIcon className='h-5 w-5' />;
      case ViewLayout.Grid:
        return <GridIcon className='h-5 w-5' />;
      default:
        return <DocIcon className='h-5 w-5' />;
    }
  }

  if(isEmoji) {
    return <span
      className={'flex justify-center items-center'}
      style={{
        width: 20,
        height: 20,
      }}
    >{icon.value}</span>;
  }

  return customIcon;

}

export default PageIcon;

