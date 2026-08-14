import { useMemo } from 'react';

import { ViewIcon, ViewIconType, ViewLayout } from '@/application/types';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { cn } from '@/lib/utils';
import { isFlagEmoji } from '@/utils/emoji';

const CUSTOM_ICON_PATH = /^(?:https?:\/\/|file:\/\/|\/|[A-Za-z]:\\)/;

/** Infer the legacy row-meta icon encoding in the same order as Desktop. */
export function resolveGalleryRowIcon(rawIcon: string): ViewIcon | null {
  if (!rawIcon) return null;

  try {
    const value = JSON.parse(rawIcon) as { groupName?: unknown; iconName?: unknown };

    if (typeof value?.groupName === 'string' && typeof value.iconName === 'string') {
      return { ty: ViewIconType.Icon, value: rawIcon };
    }
  } catch {
    // Emoji and custom-image values are intentionally not JSON.
  }

  if (CUSTOM_ICON_PATH.test(rawIcon)) return { ty: ViewIconType.URL, value: rawIcon };
  return { ty: ViewIconType.Emoji, value: rawIcon };
}

export function GalleryRowIcon({ className, icon }: { className?: string; icon: string }) {
  const resolvedIcon = useMemo(() => resolveGalleryRowIcon(icon), [icon]);

  if (!resolvedIcon) return null;

  return (
    <span aria-hidden='true' className={cn('flex h-4 w-4 shrink-0 items-center justify-center', className)}>
      <PageIcon
        className={cn(
          'h-4 w-4 text-base leading-4 text-[var(--gallery-card-hint)]',
          resolvedIcon.ty === ViewIconType.Emoji && isFlagEmoji(resolvedIcon.value) && 'icon'
        )}
        hideLayoutFallback
        iconSize={16}
        view={{ icon: resolvedIcon, layout: ViewLayout.Document }}
      />
    </span>
  );
}

export default GalleryRowIcon;
