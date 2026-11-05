import { ReactNode, useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ReactComponent as RegenerateIcon } from '@/assets/icons/ai_regenerate.svg';
import { ReactComponent as CopyIcon } from '@/assets/icons/copy.svg';
import { ReactComponent as DownloadIcon } from '@/assets/icons/download.svg';
import { ReactComponent as ErrorIcon } from '@/assets/icons/error.svg';
import { ReactComponent as PreviewIcon } from '@/assets/icons/full_screen.svg';
import GalleryPreview from '@/components/_shared/gallery-preview/GalleryPreview';
import { Alert, AlertDescription } from '@/components/chat/components/ui/alert';
import LoadingDots from '@/components/chat/components/ui/loading-dots';
import { fileNameFromAttachmentUrl } from '@/components/chat/lib/attachments';
import { isChatFileUrl } from '@/components/chat/lib/image-format';
import {
  useImageWithRetry,
  UseImageWithRetryOptions,
} from '@/components/editor/components/blocks/image/useImageWithRetry';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { downloadBlob } from '@/utils/download';
import { convertBlobToPng, fetchImageBlob } from '@/utils/image';

const DEFAULT_FILE_NAME = 'generated-image.png';

// Generation usually finishes within a minute; poll every few seconds for about
// three minutes before giving up (the server retries a failed provider call too).
const GENERATED_IMAGE_RETRY: UseImageWithRetryOptions = {
  notFoundBackoffMs: [3000, 3000, 4000, ...Array<number>(34).fill(5000)],
};

/** Generated files are stored without an extension, so the download gets one. */
function downloadFileName(url: string): string {
  const name = fileNameFromAttachmentUrl(url);

  if (!name || name === url) return DEFAULT_FILE_NAME;

  return /\.[a-z0-9]{2,5}$/i.test(name) ? name : `${name}.png`;
}

function ImageAction({
  tooltip,
  onClick,
  disabled,
  testId,
  children,
}: {
  tooltip: string;
  onClick: () => void;
  disabled?: boolean;
  testId?: string;
  children: ReactNode;
}) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <Button
          variant={'ghost'}
          size={'icon'}
          disabled={disabled}
          aria-label={tooltip}
          data-testid={testId}
          onMouseDown={(e) => e.preventDefault()}
          onClick={onClick}
        >
          {children}
        </Button>
      </TooltipTrigger>
      <TooltipContent side={'bottom'}>{tooltip}</TooltipContent>
    </Tooltip>
  );
}

export interface GeneratedImageProps {
  url: string;
  alt?: string;
  /** Regenerates the whole answer with its original image format. */
  onRegenerate?: () => void;
  /** `attachment` renders a smaller thumbnail for pictures the user sent. */
  variant?: 'answer' | 'attachment';
}

/**
 * Renders an image produced by the AI service. Generation runs in the
 * background after the answer stream ends, so the file is fetched with a
 * status-aware backoff (a few minutes) instead of failing after a fixed delay,
 * and the user gets preview, copy, download and regenerate actions.
 */
export function GeneratedImage({ url, alt, onRegenerate, variant = 'answer' }: GeneratedImageProps) {
  const { t } = useTranslation();
  const attachment = variant === 'attachment';
  const generated = useMemo(() => !attachment && isChatFileUrl(url), [attachment, url]);
  const { src, phase, isImageReady, retry, onImageLoaded, onImageError } = useImageWithRetry(
    url,
    undefined,
    generated ? GENERATED_IMAGE_RETRY : undefined
  );
  const [previewOpen, setPreviewOpen] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const fileName = useMemo(() => downloadFileName(url), [url]);

  const handleDownload = useCallback(async () => {
    setDownloading(true);

    try {
      const blob = await fetchImageBlob(url);

      if (!blob) {
        throw new Error('Image download returned no data');
      }

      downloadBlob(blob, fileName);
    } catch (error) {
      console.error('Failed to download generated image', error);
      toast.error(t('chat.image.downloadFailed'));
    } finally {
      setDownloading(false);
    }
  }, [fileName, t, url]);

  const handleCopy = useCallback(async () => {
    try {
      let blob = await fetchImageBlob(url);

      if (!blob) {
        throw new Error('Image copy returned no data');
      }

      // Browser clipboards generally accept PNG only.
      if (blob.type !== 'image/png') {
        blob = await convertBlobToPng(blob);
      }

      await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
      toast.success(t('chat.image.copied'), { duration: 2000 });
    } catch (error) {
      console.error('Failed to copy generated image', error);
      toast.error(t('chat.image.copyFailed'));
    }
  }, [t, url]);

  if (phase === 'failed') {
    return (
      <Alert className={'w-full max-w-[480px] border-none bg-fill-error-light text-foreground'} data-testid='chat-generated-image-failed'>
        <AlertDescription>
          <div className={'flex flex-wrap items-center gap-3'}>
            <ErrorIcon className={'!min-h-5 !min-w-5 text-icon-error-thick'} />
            <span className={'min-w-0 flex-1'}>{t('chat.image.failed')}</span>
            <div className={'flex gap-2'}>
              <Button variant={'outline'} size={'sm'} onClick={retry} data-testid='chat-generated-image-retry'>
                {t('chat.image.retry')}
              </Button>
              {onRegenerate ? (
                <Button variant={'outline'} size={'sm'} onClick={onRegenerate} data-testid='chat-generated-image-regenerate'>
                  {t('chat.image.regenerate')}
                </Button>
              ) : null}
            </div>
          </div>
        </AlertDescription>
      </Alert>
    );
  }

  return (
    <div
      className={'group relative w-fit max-w-full'}
      data-testid='chat-generated-image'
      data-phase={isImageReady ? 'ready' : phase}
    >
      {!isImageReady ? (
        <div
          className={cn(
            'flex max-w-full flex-col items-center justify-center gap-3 rounded-lg border border-border-primary bg-fill-content-hover px-4 text-center text-sm text-text-secondary',
            attachment ? 'h-[120px] w-[160px]' : 'h-[240px] w-[320px]'
          )}
        >
          <LoadingDots />
          <span>{generated ? t('chat.image.generating') : t('chat.image.loading')}</span>
        </div>
      ) : null}
      {src ? (
        <img
          src={src}
          alt={alt || t('chat.image.alt')}
          draggable={false}
          onLoad={onImageLoaded}
          onError={onImageError}
          className={cn(
            'max-w-full rounded-lg object-contain',
            attachment ? 'max-h-[200px]' : 'max-h-[480px]',
            !isImageReady && 'hidden'
          )}
        />
      ) : null}
      {isImageReady ? (
        <div
          className={
            'absolute right-2 top-2 flex gap-0.5 rounded-[8px] border border-border-primary bg-fill-toolbar p-0.5 opacity-0 shadow transition-opacity focus-within:opacity-100 group-hover:opacity-100'
          }
        >
          <ImageAction tooltip={t('chat.image.preview')} onClick={() => setPreviewOpen(true)} testId='chat-generated-image-preview'>
            <PreviewIcon className={'h-5 w-5'} />
          </ImageAction>
          <ImageAction tooltip={t('chat.image.copy')} onClick={() => void handleCopy()} testId='chat-generated-image-copy'>
            <CopyIcon className={'h-5 w-5'} />
          </ImageAction>
          <ImageAction
            tooltip={t('chat.image.download')}
            onClick={() => void handleDownload()}
            disabled={downloading}
            testId='chat-generated-image-download'
          >
            <DownloadIcon className={'h-5 w-5'} />
          </ImageAction>
          {onRegenerate ? (
            <ImageAction tooltip={t('chat.image.regenerate')} onClick={onRegenerate} testId='chat-generated-image-regenerate'>
              <RegenerateIcon className={'h-5 w-5'} />
            </ImageAction>
          ) : null}
        </div>
      ) : null}
      {previewOpen ? (
        <GalleryPreview
          images={[{ src: url }]}
          open={previewOpen}
          onClose={() => setPreviewOpen(false)}
          previewIndex={0}
          workspaceId={''}
          viewId={''}
        />
      ) : null}
    </div>
  );
}

export default GeneratedImage;
