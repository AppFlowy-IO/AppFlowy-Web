import { ReactNode, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as ImageIcon } from '@/assets/icons/image.svg';
import { Textarea } from '@/components/chat/components/ui/textarea';
import { useImageGenerationAvailable } from '@/components/chat/contexts/model-selector-context';
import { ImageQualityPreset, ImageSizePreset, isImageContent } from '@/components/chat/lib/image-format';
import { useResponseFormatContext } from '@/components/chat/provider/response-format-provider';
import { OutputContent } from '@/components/chat/types';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface SegmentOption<T> {
  value: T;
  label: string;
}

function Segmented<T extends string | number>({
  value,
  options,
  onChange,
  testId,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  testId: string;
}) {
  return (
    <div className={'flex flex-wrap gap-1'} role={'radiogroup'} data-testid={testId}>
      {options.map((option) => {
        const selected = option.value === value;

        return (
          <Button
            key={String(option.value)}
            type={'button'}
            role={'radio'}
            aria-checked={selected}
            variant={'ghost'}
            size={'sm'}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => onChange(option.value)}
            className={cn(
              'h-7 border px-2 text-xs',
              selected
                ? 'border-border-primary bg-fill-content-hover text-text-primary'
                : 'border-transparent text-text-secondary'
            )}
          >
            {option.label}
          </Button>
        );
      })}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className={'flex flex-col gap-1'}>
      <span className={'text-xs text-text-secondary'}>{label}</span>
      {children}
    </div>
  );
}

/**
 * One place to ask for a picture: output mode, size, quality and an optional
 * dedicated image prompt. The choice shows as a labelled chip in the toolbar so
 * the user sees what the next message will do, and it clears after sending.
 */
export function ImageOptionsButton({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const { responseFormat, setOutputContent, imageOptions, setImageOptions } = useResponseFormatContext();
  const imageGenerationAvailable = useImageGenerationAvailable();
  const [open, setOpen] = useState(false);

  const content = responseFormat.output_content;
  const active = isImageContent(content);

  const modeOptions = useMemo<SegmentOption<OutputContent>[]>(
    () => [
      { value: OutputContent.TEXT, label: t('chat.image.modeOff') },
      { value: OutputContent.IMAGE, label: t('chat.image.modeImageOnly') },
      { value: OutputContent.RichTextImage, label: t('chat.image.modeTextWithImage') },
    ],
    [t]
  );
  const sizeOptions = useMemo<SegmentOption<ImageSizePreset>[]>(
    () => [
      { value: 'auto', label: t('chat.image.sizeAuto') },
      { value: 'square', label: t('chat.image.sizeSquare') },
      { value: 'landscape', label: t('chat.image.sizeLandscape') },
      { value: 'portrait', label: t('chat.image.sizePortrait') },
    ],
    [t]
  );
  const qualityOptions = useMemo<SegmentOption<ImageQualityPreset>[]>(
    () => [
      { value: 'auto', label: t('chat.image.qualityAuto') },
      { value: 'standard', label: t('chat.image.qualityStandard') },
      { value: 'hd', label: t('chat.image.qualityHd') },
    ],
    [t]
  );

  const summary = useMemo(() => {
    if (!active) return '';

    const parts = [modeOptions.find((option) => option.value === content)?.label];

    if (imageOptions.size !== 'auto') {
      parts.push(sizeOptions.find((option) => option.value === imageOptions.size)?.label);
    }

    if (imageOptions.quality !== 'auto') {
      parts.push(qualityOptions.find((option) => option.value === imageOptions.quality)?.label);
    }

    return parts.filter(Boolean).join(' · ');
  }, [active, content, imageOptions.quality, imageOptions.size, modeOptions, qualityOptions, sizeOptions]);

  // Without an image model every image request would fail after sending.
  if (!imageGenerationAvailable) return null;

  return (
    <div className={'flex items-center'}>
      <Popover open={open} onOpenChange={setOpen}>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                variant={'ghost'}
                size={active ? 'sm' : 'icon'}
                disabled={disabled}
                data-active={active || undefined}
                data-testid='chat-input-image-options'
                className={cn('h-7', active && 'gap-1 bg-fill-content-hover px-2 text-text-primary')}
              >
                <ImageIcon className={cn('h-5 w-5', active ? 'text-primary' : 'text-icon-secondary')} />
                {active ? <span className={'text-xs'}>{summary}</span> : null}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{t('chat.image.title')}</TooltipContent>
        </Tooltip>
        <PopoverContent
          align={'start'}
          onOpenAutoFocus={(e) => e.preventDefault()}
          className={'flex w-[340px] flex-col gap-3 p-3'}
          data-testid='chat-image-options-popover'
        >
          <div className={'text-sm font-medium text-text-primary'}>{t('chat.image.title')}</div>
          <Field label={t('chat.image.mode')}>
            <Segmented value={content} options={modeOptions} onChange={setOutputContent} testId='chat-image-mode' />
          </Field>
          {active ? (
            <>
              <Field label={t('chat.image.size')}>
                <Segmented
                  value={imageOptions.size}
                  options={sizeOptions}
                  onChange={(size) => setImageOptions({ size })}
                  testId='chat-image-size'
                />
              </Field>
              <Field label={t('chat.image.quality')}>
                <Segmented
                  value={imageOptions.quality}
                  options={qualityOptions}
                  onChange={(quality) => setImageOptions({ quality })}
                  testId='chat-image-quality'
                />
              </Field>
              <Field label={t('chat.image.promptLabel')}>
                <Textarea
                  rows={2}
                  value={imageOptions.customImagePrompt}
                  onChange={(e) => setImageOptions({ customImagePrompt: e.target.value })}
                  placeholder={t('chat.image.promptPlaceholder')}
                  className={'min-h-[56px] resize-none !text-sm'}
                  data-testid='chat-image-prompt'
                />
              </Field>
              <span className={'text-xs text-text-tertiary'}>{t('chat.image.hint')}</span>
            </>
          ) : null}
        </PopoverContent>
      </Popover>
      {active ? (
        <Tooltip>
          <TooltipTrigger asChild>
            <Button
              variant={'ghost'}
              size={'icon-sm'}
              aria-label={t('chat.image.turnOff')}
              data-testid='chat-input-image-off'
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setOutputContent(OutputContent.TEXT)}
            >
              <CloseIcon className={'h-4 w-4 text-icon-secondary'} />
            </Button>
          </TooltipTrigger>
          <TooltipContent>{t('chat.image.turnOff')}</TooltipContent>
        </Tooltip>
      ) : null}
    </div>
  );
}

export default ImageOptionsButton;
