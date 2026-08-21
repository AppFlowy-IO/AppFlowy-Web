import { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, FieldVisibility, useFieldsSelector, useGalleryLayoutSettings } from '@/application/database-yjs';
import { useUpdateGalleryLayoutSettings } from '@/application/database-yjs/dispatch';
import { GalleryCardPreview, GalleryCardSize } from '@/application/types';
import { ReactComponent as GalleryIcon } from '@/assets/icons/gallery.svg';
import {
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';

import type { ReactNode } from 'react';

const GALLERY_SETTING_FIELD_VISIBILITIES = [
  FieldVisibility.AlwaysShown,
  FieldVisibility.HideWhenEmpty,
  FieldVisibility.AlwaysHidden,
];

const GALLERY_SETTING_ROW_CLASS_NAME = 'mx-1.5 h-[26px] !min-h-[26px] w-[calc(100%-12px)] px-2.5 py-0';
const GALLERY_OPTION_ROW_CLASS_NAME = 'h-[26px] !min-h-[26px] w-full py-0';

// Flutter paints this 1px stroke outside the popover, so a ring preserves its fixed content dimensions.
export const GALLERY_POPOVER_SHELL_CLASS_NAME =
  'rounded-[10px] border-0 bg-white ring-1 ring-[#EDEDEE] shadow-[0_4px_20px_rgba(31,35,41,0.102)] [[data-dark-mode=true]_&]:bg-[#282E3A] [[data-dark-mode=true]_&]:ring-[#3A3F49] [[data-dark-mode=true]_&]:shadow-[0_2px_16px_rgba(0,0,0,0.478)]';

function GallerySectionHeader({ children }: { children: ReactNode }) {
  return (
    <DropdownMenuLabel className='min-h-0 px-3 py-2 text-xs font-semibold text-text-tertiary'>
      {children}
    </DropdownMenuLabel>
  );
}

function GallerySectionGap() {
  return <div aria-hidden='true' className='h-2' data-gallery-settings-section-gap />;
}

function GalleryCardSizeSetting({ value }: { value: GalleryCardSize }) {
  const { t } = useTranslation();
  const update = useUpdateGalleryLayoutSettings();
  const options = useMemo(
    () => [
      { label: t('gallery.small', { defaultValue: 'Small' }), value: GalleryCardSize.Small },
      { label: t('gallery.medium', { defaultValue: 'Medium' }), value: GalleryCardSize.Medium },
      { label: t('gallery.large', { defaultValue: 'Large' }), value: GalleryCardSize.Large },
    ],
    [t]
  );
  const current = options.find((option) => option.value === value) ?? options[1];

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={GALLERY_SETTING_ROW_CLASS_NAME} data-testid='gallery-card-size-trigger'>
        {current.label}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent
          className={cn(GALLERY_POPOVER_SHELL_CLASS_NAME, 'flex w-[112px] !min-w-[112px] flex-col gap-1 p-1.5')}
          data-testid='gallery-card-size-menu'
          sideOffset={14}
        >
          {options.map((option) => (
            <DropdownMenuItem
              className={GALLERY_OPTION_ROW_CLASS_NAME}
              data-testid={`gallery-card-size-${option.label.toLowerCase()}`}
              key={option.value}
              onSelect={(event) => {
                event.preventDefault();
                update({ cardSize: option.value, showCover: true });
              }}
            >
              {option.label}
              {value === option.value ? <DropdownMenuItemTick /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

function GalleryCardPreviewSetting({
  coverFieldId,
  mediaFieldIds,
  value,
}: {
  coverFieldId?: string;
  mediaFieldIds: string[];
  value: GalleryCardPreview;
}) {
  const { t } = useTranslation();
  const update = useUpdateGalleryLayoutSettings();
  const options = useMemo(
    () => [
      { label: t('gallery.pageCover', { defaultValue: 'Page cover' }), value: GalleryCardPreview.PageCover },
      { label: t('gallery.pageContent', { defaultValue: 'Page content' }), value: GalleryCardPreview.PageContent },
      {
        label: t('gallery.filesAndMedia', { defaultValue: 'Files & media' }),
        value: GalleryCardPreview.FilesAndMedia,
      },
    ],
    [t]
  );
  const current = options.find((option) => option.value === value) ?? options[0];

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger className={GALLERY_SETTING_ROW_CLASS_NAME} data-testid='gallery-card-preview-trigger'>
        {current.label}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent
          className={cn(GALLERY_POPOVER_SHELL_CLASS_NAME, 'flex w-[152px] !min-w-[152px] flex-col gap-1 p-1.5')}
          data-testid='gallery-card-preview-menu'
          sideOffset={14}
        >
          {options.map((option) => (
            <DropdownMenuItem
              className={GALLERY_OPTION_ROW_CLASS_NAME}
              data-testid={`gallery-card-preview-${option.value}`}
              key={option.value}
              onSelect={(event) => {
                event.preventDefault();
                const nextCoverFieldId =
                  option.value === GalleryCardPreview.FilesAndMedia
                    ? mediaFieldIds.includes(coverFieldId ?? '')
                      ? coverFieldId
                      : mediaFieldIds[0] ?? null
                    : coverFieldId;

                update({
                  cardPreview: option.value,
                  coverFieldId: nextCoverFieldId,
                  showCover: true,
                });
              }}
            >
              {option.label}
              {value === option.value ? <DropdownMenuItemTick /> : null}
            </DropdownMenuItem>
          ))}
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export function GalleryLayoutSettings() {
  const { t } = useTranslation();
  const settings = useGalleryLayoutSettings();
  const update = useUpdateGalleryLayoutSettings();
  const fields = useFieldsSelector(GALLERY_SETTING_FIELD_VISIBILITIES);
  const mediaFieldIds = useMemo(
    () => fields.filter((field) => field.fieldType === FieldType.Media).map((field) => field.fieldId),
    [fields]
  );

  useEffect(() => {
    if (settings.cardPreview !== GalleryCardPreview.FilesAndMedia) return;
    if (mediaFieldIds.includes(settings.coverFieldId ?? '')) return;
    update({ coverFieldId: mediaFieldIds[0] ?? null, showCover: true });
  }, [mediaFieldIds, settings.cardPreview, settings.coverFieldId, update]);

  return (
    <DropdownMenuSub>
      <DropdownMenuSubTrigger data-testid='gallery-layout-settings-trigger'>
        <GalleryIcon aria-hidden='true' />
        {t('gallery.menuName', { defaultValue: 'Gallery' })}
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent
          className={cn(GALLERY_POPOVER_SHELL_CLASS_NAME, 'w-[220px] !min-w-[220px] p-0')}
          data-testid='gallery-layout-settings-menu'
          sideOffset={10}
        >
          <GallerySectionHeader>{t('gallery.cardSize', { defaultValue: 'Card size' })}</GallerySectionHeader>
          <GalleryCardSizeSetting value={settings.cardSize} />
          <GallerySectionGap />

          <GallerySectionHeader>{t('gallery.cardPreview', { defaultValue: 'Card preview' })}</GallerySectionHeader>
          <GalleryCardPreviewSetting
            coverFieldId={settings.coverFieldId}
            mediaFieldIds={mediaFieldIds}
            value={settings.cardPreview}
          />
          <GallerySectionGap />

          <GallerySectionHeader>{t('gallery.coverImage', { defaultValue: 'Cover image' })}</GallerySectionHeader>
          <DropdownMenuItem
            aria-checked={settings.fitImage}
            className={GALLERY_SETTING_ROW_CLASS_NAME}
            data-testid='gallery-fit-image-toggle'
            onSelect={(event) => {
              event.preventDefault();
              update({ fitImage: !settings.fitImage, showCover: true });
            }}
            role='menuitemcheckbox'
          >
            {t('gallery.fitImage', { defaultValue: 'Fit image' })}
            <span
              aria-hidden='true'
              className={cn(
                'relative ml-auto h-4 w-[27px] shrink-0 rounded-full',
                settings.fitImage ? 'bg-[#00BCF0]' : 'bg-[#E0E0E0] [[data-dark-mode=true]_&]:bg-[#828282]'
              )}
              data-state={settings.fitImage ? 'checked' : 'unchecked'}
              data-testid='gallery-fit-image-switch'
            >
              <span
                className={cn(
                  'absolute left-px top-px h-3.5 w-3.5 rounded-full bg-white transition-transform duration-150 motion-reduce:transition-none',
                  settings.fitImage && 'translate-x-[11px]'
                )}
              />
            </span>
          </DropdownMenuItem>
          <GallerySectionGap />
        </DropdownMenuSubContent>
      </DropdownMenuPortal>
    </DropdownMenuSub>
  );
}

export default GalleryLayoutSettings;
