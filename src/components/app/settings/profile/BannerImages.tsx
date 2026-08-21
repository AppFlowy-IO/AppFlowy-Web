import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { EmbedLink, TAB_KEY, TabOption, UploadImage, UploadPopover } from '@/components/_shared/image-upload';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { Banner, DEFAULT_BANNERS, isSameBanner } from './banner';
import BannerTile from './BannerTile';

/**
 * "Banner Image" section: a custom uploaded image in the first cell, then the 8 wallpaper presets.
 * Both rows use the same 4-column / 6px-gutter / 52px-tall grid as desktop.
 */
export function BannerImages({
  selected,
  customBanner,
  onSelect,
  onUploadCustom,
  uploadAction,
}: {
  selected: Banner;
  customBanner: Banner | null;
  onSelect: (banner: Banner) => void;
  onUploadCustom: (url: string) => void;
  uploadAction: (file: File) => Promise<string>;
}) {
  const { t } = useTranslation();
  const [pickerOpen, setPickerOpen] = useState(false);

  const handleDone = useCallback(
    (url: string) => {
      if (!url) return;
      onUploadCustom(url);
      setPickerOpen(false);
    },
    [onUploadCustom]
  );

  const tabOptions: TabOption[] = useMemo(
    () => [
      {
        key: TAB_KEY.UPLOAD,
        label: t('button.upload'),
        Component: UploadImage,
        uploadAction,
        onDone: handleDone,
      },
      {
        key: TAB_KEY.EMBED_LINK,
        label: t('document.imageBlock.embedLink.label'),
        Component: EmbedLink,
        onDone: handleDone,
      },
    ],
    [handleDone, t, uploadAction]
  );

  // Memoised so the custom tile's props stay stable and its `memo` holds.
  const replaceChip = useMemo(
    () => (
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type='button'
            aria-label={t('settings.profilePage.replaceImage')}
            data-testid='profile-replace-banner-button'
            className='absolute right-2 top-2 hidden rounded-200 bg-surface-layer-01 p-1 text-icon-secondary group-hover:block'
            onClick={(e) => {
              e.stopPropagation();
              setPickerOpen(true);
            }}
          >
            <EditIcon className='h-4 w-4' />
          </button>
        </TooltipTrigger>
        <TooltipContent side='top'>{t('settings.profilePage.replaceImage')}</TooltipContent>
      </Tooltip>
    ),
    [t]
  );

  return (
    <div className='flex flex-col items-start'>
      <span className='text-sm font-medium text-text-primary'>{t('settings.profilePage.bannerImage')}</span>

      <span className='mt-3 text-xs font-bold text-text-tertiary'>{t('settings.profilePage.customImage')}</span>
      <div className='mt-1 grid w-full max-w-[660px] grid-cols-4 gap-[6px]'>
        <div className='relative'>
          {customBanner && (
            <BannerTile
              banner={customBanner}
              selected={isSameBanner(customBanner, selected)}
              data-testid='profile-custom-banner'
              onSelect={onSelect}
              overlay={replaceChip}
            />
          )}
          {/* When a custom banner exists the tile itself selects it, so the popover hangs off a
              zero-height anchor and is opened by the hover "replace" chip instead. */}
          <UploadPopover open={pickerOpen} onOpenChange={setPickerOpen} tabOptions={tabOptions}>
            {customBanner ? (
              <span aria-hidden className='pointer-events-none absolute inset-x-0 bottom-0 block h-0' />
            ) : (
              <button
                type='button'
                data-testid='profile-upload-banner-button'
                aria-label={t('settings.profilePage.customImage')}
                className='flex h-[52px] w-full items-center justify-center rounded-300 border border-border-primary text-icon-primary hover:bg-fill-content-hover'
              >
                <PlusIcon className='h-5 w-5' />
              </button>
            )}
          </UploadPopover>
        </div>
      </div>

      <span className='mt-5 text-xs font-bold text-text-tertiary'>{t('settings.profilePage.wallpapers')}</span>
      <div className='mt-1 grid w-full max-w-[660px] grid-cols-4 gap-[6px]'>
        {DEFAULT_BANNERS.map((banner, index) => (
          <BannerTile
            key={banner.kind === 'asset' ? banner.path : `color-${banner.kind === 'color' ? banner.color : index}`}
            banner={banner}
            selected={isSameBanner(banner, selected)}
            isDefault={index === 0}
            data-testid={`profile-wallpaper-${index}`}
            onSelect={onSelect}
          />
        ))}
      </div>
    </div>
  );
}

export default BannerImages;
