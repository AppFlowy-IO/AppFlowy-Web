import { memo, useCallback } from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '@/lib/utils';

import { Banner, getAssetBannerSrc } from './banner';
import { useAuthenticatedImage } from './useAuthenticatedImage';

export interface BannerTileProps {
  banner: Banner;
  selected: boolean;
  isDefault?: boolean;
  className?: string;
  'data-testid'?: string;
  /** Rendered on top of the swatch, e.g. the hover "replace image" affordance. */
  overlay?: React.ReactNode;
  /**
   * Receives this tile's own banner. Taking the banner rather than a pre-bound
   * `onClick` keeps the prop stable across renders so `memo` below actually holds.
   */
  onSelect?: (banner: Banner) => void;
}

/**
 * A single 52px-tall banner swatch. The selected/hovered state is drawn as a
 * two-layer inset ring (2px accent outside, 2px page-background inside) to match desktop.
 *
 * Memoised because all nine tiles otherwise re-render on every keystroke in the
 * panel's text fields.
 */
export const BannerTile = memo(function BannerTile({
  banner,
  selected,
  isDefault = false,
  className,
  overlay,
  onSelect,
  ...props
}: BannerTileProps) {
  const { t } = useTranslation();
  const networkSrc = useAuthenticatedImage(banner.kind === 'network' ? banner.url : undefined);
  const handleClick = useCallback(() => onSelect?.(banner), [onSelect, banner]);

  return (
    <div
      className={cn('group relative h-[52px] w-full cursor-pointer overflow-hidden rounded-300', className)}
      onClick={handleClick}
      {...props}
    >
      {banner.kind === 'color' ? (
        <div className='h-full w-full rounded-300' style={{ backgroundColor: banner.color }} />
      ) : (
        <img
          src={banner.kind === 'asset' ? getAssetBannerSrc(banner.path) : networkSrc}
          alt=''
          draggable={false}
          className='h-full w-full rounded-300 object-cover'
        />
      )}

      <div
        className={cn(
          'pointer-events-none absolute inset-0 rounded-300 border-2 border-transparent',
          !selected && 'group-hover:border-border-primary-hover',
          selected && 'border-border-theme-thick'
        )}
      >
        <div
          className={cn(
            'h-full w-full rounded-200 border-2 border-transparent group-hover:border-background-primary',
            selected && 'border-background-primary'
          )}
        />
      </div>

      {isDefault && (
        <div className='pointer-events-none absolute right-2 top-2 rounded-100 bg-surface-primary px-[6px] py-1 text-[10px] leading-[1.2] text-text-primary'>
          {t('settings.profilePage.default')}
        </div>
      )}

      {overlay}
    </div>
  );
});

export default BannerTile;
