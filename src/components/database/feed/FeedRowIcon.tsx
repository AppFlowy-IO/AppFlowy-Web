import { useMemo } from 'react';

import { ViewIconType, ViewLayout } from '@/application/types';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { resolveGalleryRowIcon } from '@/components/database/gallery/GalleryRowIcon';
import { cn } from '@/lib/utils';
import { isFlagEmoji } from '@/utils/emoji';

/** 24px row icon set inline with the card's H3 title (Figma feed card header). */
export function FeedRowIcon({ className, icon }: { className?: string; icon: string }) {
  const resolvedIcon = useMemo(() => resolveGalleryRowIcon(icon), [icon]);

  if (!resolvedIcon) return null;

  return (
    <span
      aria-hidden='true'
      className={cn('flex h-6 w-6 shrink-0 items-center justify-center', className)}
      data-testid='feed-card-icon'
    >
      <PageIcon
        className={cn(
          'h-6 w-6 text-2xl leading-6 text-icon-primary',
          resolvedIcon.ty === ViewIconType.Emoji && isFlagEmoji(resolvedIcon.value) && 'icon'
        )}
        hideLayoutFallback
        iconSize={24}
        view={{ icon: resolvedIcon, layout: ViewLayout.Document }}
      />
    </span>
  );
}

export default FeedRowIcon;
