import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AudioTranscriptionSource } from '@/application/integrations/audio-file-transcription';
import { AudioTranscriptionError, isDirectMediaUrl } from '@/application/integrations/transcription-media';
import { downloadYoutubeAudio, getYoutubeAudioMetadata, readTranscriptionClipboard } from '@/application/integrations/youtube-audio';
import { isHttpUrl, YoutubeAudioMetadata, youtubeDurationError, youtubeVideoId } from '@/application/integrations/youtube-url';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

function formatDuration(seconds: number) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor(seconds / 60) % 60;
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');

  return hours ? `${hours}:${String(minutes).padStart(2, '0')}:${remainder}` : `${minutes}:${remainder}`;
}

interface AIMeetingUrlDialogProps {
  workspaceId: string;
  clipboardText?: Promise<string>;
  onClose: () => void;
  onConfirm: (source: AudioTranscriptionSource) => void;
  onFailure?: (error: AudioTranscriptionError) => void;
}

export function AIMeetingUrlDialog(props: AIMeetingUrlDialogProps) {
  // Changing workspace discards its form state and aborts all pending work.
  return <AIMeetingUrlDialogContent key={props.workspaceId} {...props} />;
}

function AIMeetingUrlDialogContent({
  workspaceId,
  clipboardText,
  onClose,
  onConfirm,
  onFailure,
}: AIMeetingUrlDialogProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [touched, setTouched] = useState(false);
  const [preview, setPreview] = useState<{ url: string; metadata?: YoutubeAudioMetadata; error?: AudioTranscriptionError }>();
  const [metadataAttempt, setMetadataAttempt] = useState(0);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<{ loaded: number; total?: number }>();
  const [downloadError, setDownloadError] = useState<AudioTranscriptionError>();
  const input = useRef<HTMLInputElement>(null);
  const download = useRef<AbortController>();
  const edited = useRef(false);
  const callbacks = useRef({ onClose, onConfirm, onFailure });

  useEffect(() => {
    callbacks.current = { onClose, onConfirm, onFailure };
  }, [onClose, onConfirm, onFailure]);
  const errorId = useId();
  const target = url.trim();
  const videoId = youtubeVideoId(target);
  const current = preview?.url === target ? preview : undefined;
  const metadata = current?.metadata;
  const loading = Boolean(videoId && !current);
  const durationError = metadata ? youtubeDurationError(metadata.duration) : undefined;
  const supported = Boolean(videoId) || isDirectMediaUrl(target);
  const valid = supported && (!videoId || Boolean(metadata && !durationError)) && !downloading;
  const errorCode = downloadError?.code || current?.error?.code || durationError ||
    (touched && target && !supported ? 'unsupportedUrl' : undefined);

  useEffect(() => {
    let cancelled = false;

    void (clipboardText ?? readTranscriptionClipboard()).then((text) => {
      if (!cancelled && !edited.current && isHttpUrl(text)) {
        setUrl(text.trim());
        requestAnimationFrame(() => { if (!cancelled) input.current?.select(); });
      }
    });
    return () => { cancelled = true; };
  }, [clipboardText]);

  useEffect(() => {
    if (!videoId) return;
    const controller = new AbortController();

    setPreview(undefined);
    void getYoutubeAudioMetadata(workspaceId, target, controller.signal).then(
      (value) => { if (!controller.signal.aborted) setPreview({ url: target, metadata: value }); },
      (failure: AudioTranscriptionError) => {
        if (controller.signal.aborted) return;
        if (failure.code === 'quotaExceeded' && callbacks.current.onFailure) {
          callbacks.current.onFailure(failure);
          callbacks.current.onClose();
        } else setPreview({ url: target, error: failure });
      }
    );
    return () => controller.abort();
  }, [metadataAttempt, target, videoId, workspaceId]);

  useEffect(() => () => download.current?.abort(), []);
  useEffect(() => {
    if (!downloading) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };

    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [downloading]);

  const confirm = async () => {
    if (!valid || download.current) return;
    if (!videoId) {
      onConfirm({ url: target });
      return;
    }

    const controller = new AbortController();

    download.current = controller;
    setDownloading(true);
    setDownloadError(undefined);
    setProgress(undefined);
    try {
      const file = await downloadYoutubeAudio(workspaceId, target, metadata!, controller.signal, (loaded, total) => {
        if (!controller.signal.aborted) setProgress({ loaded, total });
      });

      if (!controller.signal.aborted) callbacks.current.onConfirm(file);
    } catch (failure) {
      if (controller.signal.aborted) return;
      const error = failure instanceof AudioTranscriptionError ? failure : new AudioTranscriptionError('youtubeDownloadFailed', failure);

      if (callbacks.current.onFailure && ['quotaExceeded', 'recordingTooLong', 'fileTooLarge'].includes(error.code)) {
        callbacks.current.onFailure(error);
        callbacks.current.onClose();
      } else setDownloadError(error);
    } finally {
      if (!controller.signal.aborted) {
        download.current = undefined;
        setDownloading(false);
      }
    }
  };

  const fraction = progress?.total ? Math.min(progress.loaded / progress.total, 1) : undefined;

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !downloading) onClose(); }}>
      <DialogContent
        container={document.getElementById('body')}
        className='ai-meeting-url-dialog w-[440px] rounded-2xl border-0 p-0 shadow-dialog'
        closeButtonClassName='right-5 top-4 h-7 w-7 p-1'
        closeLabel={t('button.close')}
        showCloseButton={!downloading}
        onEscapeKeyDown={(event) => { if (downloading) event.preventDefault(); }}
        onInteractOutside={(event) => { if (downloading) event.preventDefault(); }}
      >
        <DialogTitle className='min-h-[44px] px-5 pr-14 pt-4 text-base font-bold leading-[22px]'>
          {t('document.aiMeeting.import.urlTitle')}
        </DialogTitle>
        <DialogDescription className='sr-only'>{t('document.aiMeeting.import.urlDescription')}</DialogDescription>
        <form onSubmit={(event) => { event.preventDefault(); setTouched(true); void confirm(); }}>
          <div className='flex flex-col gap-3 px-5 py-3'>
            <input
              ref={input}
              type='url'
              autoFocus
              disabled={downloading}
              aria-label={t('document.aiMeeting.import.pasteUrl')}
              placeholder={t('document.aiMeeting.import.urlPlaceholder')}
              className={cn('w-full border border-border-primary bg-transparent px-2 text-sm leading-5 outline-none placeholder:text-text-tertiary focus:border-border-theme-thick', videoId ? 'h-10 rounded-[10px]' : 'h-8 rounded-lg')}
              value={url}
              onChange={(event) => {
                edited.current = true;
                setUrl(event.target.value);
                setTouched(false);
                setDownloadError(undefined);
              }}
              onBlur={() => setTouched(true)}
              aria-invalid={Boolean(errorCode)}
              aria-describedby={errorCode ? errorId : undefined}
            />
            {loading && <p role='status' className='text-xs leading-[18px] text-text-secondary'>{t('document.aiMeeting.import.youtubeLoading')}</p>}
            {metadata && (
              <div className='flex h-[93px] overflow-hidden rounded-xl border border-border-primary bg-surface-primary'>
                <div className='h-[93px] w-[168px] max-w-[42%] shrink-0 bg-fill-content-hover'>
                  {metadata.thumbnailUrl && <img src={metadata.thumbnailUrl} alt='' className='h-full w-full object-cover' />}
                </div>
                <div className='flex min-w-0 flex-1 flex-col gap-2 px-3 py-2'>
                  <p className='line-clamp-2 text-sm font-medium leading-5'>{metadata.title}</p>
                  <div className='flex min-w-0 items-center gap-2 text-xs leading-[18px] tracking-[0.1px] text-text-secondary'>
                    <span className='truncate font-medium'>{metadata.author}</span>
                    {metadata.duration !== undefined && <span className='shrink-0 rounded-md bg-fill-content-hover px-1.5 py-px'>{formatDuration(metadata.duration)}</span>}
                  </div>
                </div>
              </div>
            )}
            {errorCode && (
              <p id={errorId} role='alert' className='text-xs leading-[18px] text-text-error'>
                {t(`document.aiMeeting.import.errors.${errorCode}`)}
                {(current?.error || downloadError) && <>{' '}<button type='button' className='font-medium underline' onClick={() => {
                  if (downloadError) void confirm();
                  else setMetadataAttempt((previous) => previous + 1);
                }}>{t('document.aiMeeting.import.retry')}</button></>}
              </p>
            )}
            {downloading && (
              <div role='status' className='flex flex-col gap-2 text-xs leading-[18px] text-text-secondary'>
                <span>{fraction === undefined ? t('document.aiMeeting.import.youtubeDownloading') : t('document.aiMeeting.import.youtubeProgress', { percent: Math.floor(fraction * 100) })}</span>
                <progress aria-label={t('document.aiMeeting.import.youtubeDownloading')} max={1} value={fraction} className='h-1 w-full accent-fill-theme-thick' />
              </div>
            )}
          </div>
          <DialogFooter className='m-0 flex-row justify-end gap-3 px-5 pb-4'>
            {downloading && <Button type='button' variant='outline' className='mr-auto h-8 font-medium' onClick={() => {
              download.current?.abort();
              download.current = undefined;
              setDownloading(false);
              setProgress(undefined);
              setDownloadError(undefined);
            }}>{t('document.aiMeeting.import.stop')}</Button>}
            <Button type='button' variant='outline' className='h-8 font-medium' disabled={downloading} onClick={onClose}>
              {t('button.cancel')}
            </Button>
            <Button type='submit' className='h-8 font-medium' disabled={!valid}>
              {downloading ? t('document.aiMeeting.import.youtubeDownloading') : t('document.aiMeeting.import.transcribe')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
