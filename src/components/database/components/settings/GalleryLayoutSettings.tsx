import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { FieldType, FieldVisibility, useFieldsSelector, useGalleryLayoutSettings } from '@/application/database-yjs';
import { useUpdateGalleryLayoutSettings } from '@/application/database-yjs/dispatch';
import { GalleryCardPreview, GalleryCardSize } from '@/application/types';
import { useSubmenuPointerGuard } from '@/components/_shared/hooks/useSubmenuPointerGuard';
import { useGalleryView } from '@/components/database/gallery/GalleryViewContext';
import {
  DropdownMenuItem,
  DropdownMenuItemTick,
  DropdownMenuLabel,
  DropdownMenuPortal,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
} from '@/components/ui/dropdown-menu';
import { Switch } from '@/components/ui/switch';

const FIELD_VISIBILITIES = [FieldVisibility.AlwaysShown, FieldVisibility.HideWhenEmpty, FieldVisibility.AlwaysHidden];

export const GALLERY_POPOVER_SHELL_CLASS_NAME = 'rounded-xl border-border-primary bg-surface-primary shadow-menu';

function GalleryChoice<T extends number>({
  label,
  value,
  options,
  testId,
  onChange,
}: {
  label: string;
  value: T;
  options: { label: string; value: T; testId: string }[];
  testId: string;
  onChange: (value: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const { contentRef, onTriggerPointerLeave } = useSubmenuPointerGuard();

  return (
    <DropdownMenuSub open={open} onOpenChange={setOpen}>
      <DropdownMenuSubTrigger
        className='h-8 gap-2 px-2 py-1.5'
        data-testid={`${testId}-trigger`}
        onPointerLeave={onTriggerPointerLeave}
      >
        <span>{label}</span>
        <span className='ml-auto truncate text-xs text-text-secondary'>
          {options.find((option) => option.value === value)?.label}
        </span>
      </DropdownMenuSubTrigger>
      <DropdownMenuPortal>
        <DropdownMenuSubContent
          ref={contentRef}
          className='w-[160px] !min-w-[160px] p-2'
          data-testid={`${testId}-menu`}
          sideOffset={8}
        >
          {options.map((option) => (
            <DropdownMenuItem
              className='h-8 px-2 py-1.5'
              data-testid={option.testId}
              key={option.value}
              onSelect={(event) => {
                event.preventDefault();
                onChange(option.value);
                setOpen(false);
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

function GalleryToggle({
  label,
  value,
  onChange,
  testId,
}: {
  label: string;
  value: boolean;
  onChange: (checked: boolean) => void;
  testId: string;
}) {
  return (
    <DropdownMenuItem
      aria-checked={value}
      className='h-8 px-2 py-1.5'
      data-testid={testId}
      onSelect={(event) => {
        event.preventDefault();
        onChange(!value);
      }}
      role='menuitemcheckbox'
    >
      {label}
      <Switch aria-hidden checked={value} className='pointer-events-none ml-auto' tabIndex={-1} />
    </DropdownMenuItem>
  );
}

/** Desktop places these four rows at the bottom of the Layout submenu. */
export function GalleryLayoutSettings() {
  const { t } = useTranslation();
  const settings = useGalleryLayoutSettings();
  const update = useUpdateGalleryLayoutSettings();
  const { compactMode, setCompactMode } = useGalleryView();
  const fields = useFieldsSelector(FIELD_VISIBILITIES);
  const mediaFieldIds = useMemo(
    () => fields.filter((field) => field.fieldType === FieldType.Media).map((field) => field.fieldId),
    [fields]
  );

  useEffect(() => {
    if (settings.cardPreview !== GalleryCardPreview.FilesAndMedia) return;
    if (mediaFieldIds.includes(settings.coverFieldId ?? '')) return;
    if (!settings.coverFieldId && mediaFieldIds.length === 0) return;
    update({ coverFieldId: mediaFieldIds[0] ?? null, showCover: true });
  }, [mediaFieldIds, settings.cardPreview, settings.coverFieldId, update]);

  return (
    <div data-testid='gallery-layout-settings-menu'>
      <DropdownMenuSeparator className='my-2' />
      <DropdownMenuLabel className='min-h-0 px-2 py-1.5 text-xs font-medium text-text-tertiary'>
        {t('gallery.menuName', 'Gallery')}
      </DropdownMenuLabel>
      <GalleryChoice
        label={t('gallery.cardPreview', 'Card preview')}
        value={settings.cardPreview}
        testId='gallery-card-preview'
        options={[
          {
            label: t('gallery.pageCover', 'Page cover'),
            value: GalleryCardPreview.PageCover,
            testId: 'gallery-card-preview-0',
          },
          {
            label: t('gallery.pageContent', 'Page content'),
            value: GalleryCardPreview.PageContent,
            testId: 'gallery-card-preview-1',
          },
          {
            label: t('gallery.filesAndMedia', 'Files & media'),
            value: GalleryCardPreview.FilesAndMedia,
            testId: 'gallery-card-preview-2',
          },
        ]}
        onChange={(cardPreview) =>
          update({
            cardPreview,
            showCover: true,
            coverFieldId:
              cardPreview === GalleryCardPreview.FilesAndMedia
                ? mediaFieldIds.includes(settings.coverFieldId ?? '')
                  ? settings.coverFieldId
                  : mediaFieldIds[0] ?? null
                : settings.coverFieldId,
          })
        }
      />
      <GalleryChoice
        label={t('gallery.cardSize', 'Card size')}
        value={settings.cardSize}
        testId='gallery-card-size'
        options={[
          { label: t('gallery.small', 'Small'), value: GalleryCardSize.Small, testId: 'gallery-card-size-small' },
          { label: t('gallery.medium', 'Medium'), value: GalleryCardSize.Medium, testId: 'gallery-card-size-medium' },
          { label: t('gallery.large', 'Large'), value: GalleryCardSize.Large, testId: 'gallery-card-size-large' },
        ]}
        onChange={(cardSize) => update({ cardSize, showCover: true })}
      />
      <GalleryToggle
        label={t('gallery.fitImage', 'Fit image')}
        value={settings.fitImage}
        onChange={(fitImage) => update({ fitImage, showCover: true })}
        testId='gallery-fit-image-toggle'
      />
      <GalleryToggle
        label={t('grid.settings.compactMode', 'Compact mode')}
        value={compactMode}
        onChange={setCompactMode}
        testId='gallery-compact-mode-toggle'
      />
    </div>
  );
}

export default GalleryLayoutSettings;
