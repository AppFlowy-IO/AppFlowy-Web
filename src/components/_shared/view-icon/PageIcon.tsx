import DOMPurify from 'dompurify';
import React, { useEffect, useMemo } from 'react';

import { ViewIcon, ViewIconType, ViewLayout } from '@/application/types';
import { ReactComponent as ChatSvg } from '@/assets/icons/ai_chat.svg';
import { ReactComponent as BoardSvg } from '@/assets/icons/board.svg';
import { ReactComponent as CalendarSvg } from '@/assets/icons/calendar.svg';
import { ReactComponent as GridSvg } from '@/assets/icons/grid.svg';
import { ReactComponent as DocumentSvg } from '@/assets/icons/page.svg';
import { cn } from '@/lib/utils';
import { getImageUrl, revokeBlobUrl } from '@/utils/authenticated-image';
import { renderColor } from '@/utils/color';
import { getIcon, isFlagEmoji } from '@/utils/emoji';

function PageIcon({
  view,
  className,
  iconSize,
}: {
  view: {
    icon?: ViewIcon | null;
    layout: ViewLayout;
  };
  className?: string;
  iconSize?: number;
}) {
  const [iconContent, setIconContent] = React.useState<string | undefined>(undefined);
  const [imgSrc, setImgSrc] = React.useState<string | undefined>(undefined);

  const emoji = useMemo(() => {
    if (view.icon && view.icon.ty === ViewIconType.Emoji && view.icon.value) {
      return view.icon.value;
    }

    return null;
  }, [view]);

  useEffect(() => {
    let currentBlobUrl: string | undefined;

    if (view.icon && view.icon.ty === ViewIconType.URL && view.icon.value) {
      void getImageUrl(view.icon.value).then((url) => {
        currentBlobUrl = url;
        setImgSrc(url);
      });
    } else {
      setImgSrc(undefined);
    }

    return () => {
      if (currentBlobUrl) {
        revokeBlobUrl(currentBlobUrl);
      }
    };
  }, [view.icon]);

  const img = useMemo(() => {
    if (imgSrc) {
      return (
        <span className={cn('flex h-full w-full items-center justify-center p-[2px]', className)}>
          <img data-testid='page-icon-image' className={'max-h-full max-w-full object-contain'} src={imgSrc} alt='icon' />
        </span>
      );
    }

    return null;
  }, [className, imgSrc]);

  const isFlag = useMemo(() => {
    return emoji ? isFlagEmoji(emoji) : false;
  }, [emoji]);

  useEffect(() => {
    if (view.icon && view.icon.ty === ViewIconType.Icon && view.icon.value) {
      try {
        const json = JSON.parse(view.icon.value);
        const id = `${json.groupName}/${json.iconName}`;

        void getIcon(id).then((item) => {
          setIconContent(
            item?.content
              .replaceAll('black', json.color ? renderColor(json.color) : 'currentColor')
              .replace('<svg', '<svg width="100%" height="100%"')
          );
        });
      } catch (e) {
        console.error(e, view.icon);
      }
    } else {
      setIconContent(undefined);
    }
  }, [view.icon]);

  const icon = useMemo(() => {
    if (iconContent) {
      const cleanSvg = DOMPurify.sanitize(iconContent, {
        USE_PROFILES: { svg: true, svgFilters: true },
      });

      return (
        <span
          style={{
            width: iconSize,
            height: iconSize,
          }}
          className={cn('h-full w-full p-[2px]', className)}
          dangerouslySetInnerHTML={{
            __html: cleanSvg,
          }}
        />
      );
    }
  }, [iconContent, iconSize, className]);

  if (emoji) {
    return (
      <>
        <span className={`${isFlag ? 'icon' : ''} ${className || ''}`}>{emoji}</span>
      </>
    );
  }

  if (img) {
    return img;
  }

  if (icon) {
    return icon;
  }

  switch (view.layout) {
    case ViewLayout.AIChat:
      return <ChatSvg className={className} />;
    case ViewLayout.Grid:
      return <GridSvg className={className} />;
    case ViewLayout.Board:
      return <BoardSvg className={className} />;
    case ViewLayout.Calendar:
      return <CalendarSvg className={className} />;
    case ViewLayout.Document:
      return <DocumentSvg className={className} />;
    default:
      return null;
  }
}

export default PageIcon;
