import { useMemo } from 'react';

import { ViewIconType, ViewLayout } from '@/application/types';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { resolveGalleryRowIcon } from '@/components/database/gallery/GalleryRowIcon';
import { cn } from '@/lib/utils';
import { isFlagEmoji } from '@/utils/emoji';

/** 20px row icon shown before the feed card title (`FeedCard._buildHeader`). */
export function FeedRowIcon({ className, icon }: { className?: string; icon: string }) {
  const resolvedIcon = useMemo(() => resolveGalleryRowIcon(icon), [icon]);

  if (!resolvedIcon) return null;

  return (
    <span
      aria-hidden='true'
      className={cn('flex h-5 w-5 shrink-0 items-center justify-center', className)}
      data-testid='feed-card-icon'
    >
      <PageIcon
        className={cn(
          'h-5 w-5 text-xl leading-5 text-icon-primary',
          resolvedIcon.ty === ViewIconType.Emoji && isFlagEmoji(resolvedIcon.value) && 'icon'
        )}
        hideLayoutFallback
        iconSize={20}
        view={{ icon: resolvedIcon, layout: ViewLayout.Document }}
      />
    </span>
  );
}

export default FeedRowIcon;
