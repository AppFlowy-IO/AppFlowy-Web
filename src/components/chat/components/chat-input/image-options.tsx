import * as RadioGroup from '@radix-ui/react-radio-group';
import { useId, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as ImageIcon } from '@/assets/icons/image.svg';
import { useImageGenerationAvailable } from '@/components/chat/contexts/model-selector-context';
import { ImageQualityPreset, ImageSizePreset, isImageContent } from '@/components/chat/lib/image-format';
import { useResponseFormatContext } from '@/components/chat/provider/response-format-provider';
import { OutputContent } from '@/components/chat/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
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
  label,
  disabled,
}: {
  value: T;
  options: SegmentOption<T>[];
  onChange: (value: T) => void;
  testId: string;
  label: string;
  disabled?: boolean;
}) {
  const labelId = useId();

  return (
    <div className={'flex flex-col gap-1'}>
      <Label id={labelId} className={'leading-[18px] text-text-secondary'}>
        {label}
      </Label>
      <RadioGroup.Root
        value={String(value)}
        onValueChange={(nextValue) => {
          const option = options.find((item) => String(item.value) === nextValue);

          if (option) onChange(option.value);
        }}
        orientation={'horizontal'}
        disabled={disabled}
        aria-labelledby={labelId}
        className={'flex flex-wrap gap-1'}
        data-testid={testId}
      >
        {options.map((option) => (
          <RadioGroup.Item key={String(option.value)} value={String(option.value)} asChild>
            <Button
              type={'button'}
              variant={'ghost'}
              className={
                'h-8 !rounded-200 border border-border-primary px-2 text-sm font-medium text-text-secondary focus-visible:ring-2 focus-visible:ring-border-theme-thick data-[state=checked]:border-border-theme-thick data-[state=checked]:bg-fill-theme-select data-[state=checked]:text-text-primary'
              }
            >
              {option.label}
            </Button>
          </RadioGroup.Item>
        ))}
      </RadioGroup.Root>
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
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  const promptId = useId();
  const hintId = useId();

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
    <div className={'flex min-w-0 max-w-full items-center'}>
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
                aria-label={active ? `${t('chat.image.title')}: ${summary}` : t('chat.image.title')}
                data-active={active || undefined}
                data-testid='chat-input-image-options'
                className={cn(
                  'h-7 min-w-0 max-w-[240px] shrink focus-visible:ring-2 focus-visible:ring-border-theme-thick',
                  active && 'gap-1 bg-fill-theme-select px-2 text-text-primary'
                )}
              >
                <ImageIcon className={cn('h-5 w-5', active ? 'text-icon-info-thick' : 'text-icon-secondary')} />
                {active ? <span className={'min-w-0 truncate text-xs'}>{summary}</span> : null}
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>{active ? `${t('chat.image.title')}: ${summary}` : t('chat.image.title')}</TooltipContent>
        </Tooltip>
        <PopoverContent
          ref={panelRef}
          align={'start'}
          aria-labelledby={titleId}
          onOpenAutoFocus={(event) => {
            const selected = panelRef.current?.querySelector<HTMLButtonElement>('[role="radio"][aria-checked="true"]');

            if (selected) {
              event.preventDefault();
              selected.focus();
            }
          }}
          className={
            'flex max-h-[var(--radix-popover-content-available-height)] w-[340px] max-w-[calc(100vw-16px)] flex-col gap-3 overflow-y-auto rounded-400 border border-border-primary bg-surface-layer-04 p-3 text-text-primary shadow-popover'
          }
          data-testid='chat-image-options-popover'
        >
          <div id={titleId} className={'text-sm font-medium text-text-primary'}>
            {t('chat.image.title')}
          </div>
          <Segmented
            label={t('chat.image.mode')}
            value={content}
            options={modeOptions}
            onChange={setOutputContent}
            disabled={disabled}
            testId='chat-image-mode'
          />
          {active ? (
            <>
              <Segmented
                label={t('chat.image.size')}
                value={imageOptions.size}
                options={sizeOptions}
                onChange={(size) => setImageOptions({ size })}
                disabled={disabled}
                testId='chat-image-size'
              />
              <Segmented
                label={t('chat.image.quality')}
                value={imageOptions.quality}
                options={qualityOptions}
                onChange={(quality) => setImageOptions({ quality })}
                disabled={disabled}
                testId='chat-image-quality'
              />
              <div className={'flex flex-col gap-1'}>
                <Label htmlFor={promptId} className={'leading-[18px] text-text-secondary'}>
                  {t('chat.image.promptLabel')}
                </Label>
                <TextareaAutosize
                  id={promptId}
                  minRows={2}
                  maxRows={5}
                  disabled={disabled}
                  aria-describedby={hintId}
                  value={imageOptions.customImagePrompt}
                  onChange={(e) => setImageOptions({ customImagePrompt: e.target.value })}
                  placeholder={t('chat.image.promptPlaceholder')}
                  className={'w-full rounded-[10px] py-1.5 text-text-primary disabled:bg-fill-content-hover'}
                  data-testid='chat-image-prompt'
                />
              </div>
              <span id={hintId} className={'text-xs leading-[18px] text-text-tertiary'}>
                {t('chat.image.hint')}
              </span>
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
              disabled={disabled}
              className={'focus-visible:ring-2 focus-visible:ring-border-theme-thick'}
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
