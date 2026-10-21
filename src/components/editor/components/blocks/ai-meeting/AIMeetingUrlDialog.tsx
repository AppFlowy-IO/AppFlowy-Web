import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AudioTranscriptionSource } from '@/application/integrations/audio-file-transcription';
import { AudioTranscriptionError, isDirectMediaUrl, isServiceImportError, isTransientImportError } from '@/application/integrations/transcription-media';
import { getYoutubeCaptions, getYoutubeAudioMetadata, importErrorDetails, readTranscriptionClipboard } from '@/application/integrations/youtube-audio';
import { isHttpUrl, YoutubeAudioMetadata, YoutubeCaptionTranscript, youtubeVideoId } from '@/application/integrations/youtube-url';
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
  language?: string;
  mediaDisabled?: boolean;
  onClose: () => void;
  onConfirm: (source: AudioTranscriptionSource) => void;
  onConfirmCaptions: (captions: YoutubeCaptionTranscript) => void;
  onUpload?: () => void;
  onFailure?: (error: AudioTranscriptionError) => void;
}

export function AIMeetingUrlDialog(props: AIMeetingUrlDialogProps) {
  // Changing workspace discards its form state and aborts all pending work.
  return <AIMeetingUrlDialogContent key={props.workspaceId} {...props} />;
}

function AIMeetingUrlDialogContent({
  workspaceId,
  clipboardText,
  language,
  mediaDisabled = false,
  onClose,
  onConfirm,
  onConfirmCaptions,
  onUpload,
  onFailure,
}: AIMeetingUrlDialogProps) {
  const { t } = useTranslation();
  const [url, setUrl] = useState('');
  const [touched, setTouched] = useState(false);
  const [preview, setPreview] = useState<{ url: string; metadata?: YoutubeAudioMetadata; error?: AudioTranscriptionError }>();
  const [metadataAttempt, setMetadataAttempt] = useState(0);
  const [importing, setImporting] = useState(false);
  const [selectedLanguage, setSelectedLanguage] = useState<string>();
  const [captionError, setCaptionError] = useState<AudioTranscriptionError>();
  const input = useRef<HTMLInputElement>(null);
  const importRequest = useRef<AbortController>();
  const edited = useRef(false);
  const callbacks = useRef({ onClose, onConfirmCaptions, onFailure });

  useEffect(() => {
    callbacks.current = { onClose, onConfirmCaptions, onFailure };
  }, [onClose, onConfirmCaptions, onFailure]);
  const errorId = useId();
  const target = url.trim();
  const videoId = youtubeVideoId(target);
  const current = preview?.url === target ? preview : undefined;
  const metadata = current?.metadata;
  const loading = Boolean(videoId && !current);
  const captionsUnavailable = metadata?.captionLanguages?.length === 0;
  // AppFlowy-side failures hide the upload fallback: transcription would hit the same outage.
  const youtubeFailure = (error?: AudioTranscriptionError) => Boolean(error && !isServiceImportError(error.code));
  const showUploadFallback = Boolean(videoId && (captionsUnavailable || youtubeFailure(captionError) || youtubeFailure(current?.error)));
  const canImportCaptions = Boolean(metadata && !captionsUnavailable);
  const availableLanguages = metadata?.captionLanguages;
  const preferredLanguage = availableLanguages?.find((track) => track.code.toLowerCase() === language?.toLowerCase())?.code
    ?? availableLanguages?.find((track) => track.code.split('-')[0] === language?.split('-')[0])?.code
    ?? availableLanguages?.[0]?.code;
  const captionLanguage = availableLanguages?.some((track) => track.code === selectedLanguage)
    ? selectedLanguage : preferredLanguage;
  const supported = Boolean(videoId) || isDirectMediaUrl(target);
  const valid = supported && (videoId ? canImportCaptions : !mediaDisabled) && !importing;
  const errorCode = captionError?.code || current?.error?.code || (captionsUnavailable ? 'youtubeCaptionsUnavailable' : undefined) ||
    (touched && target && !supported ? 'unsupportedUrl' : undefined);
  const activeError = captionError ?? current?.error;
  const errorDetails = activeError && (isTransientImportError(activeError.code) || isServiceImportError(activeError.code))
    ? importErrorDetails(activeError) : undefined;

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

  useEffect(() => () => importRequest.current?.abort(), []);
  useEffect(() => {
    if (!importing) return;
    const beforeUnload = (event: BeforeUnloadEvent) => { event.preventDefault(); event.returnValue = ''; };

    window.addEventListener('beforeunload', beforeUnload);
    return () => window.removeEventListener('beforeunload', beforeUnload);
  }, [importing]);

  const confirm = async () => {
    if (!valid || importRequest.current) return;
    if (!videoId) {
      onConfirm({ url: target });
      return;
    }

    const controller = new AbortController();

    importRequest.current = controller;
    setImporting(true);
    setCaptionError(undefined);
    try {
      const captions = await getYoutubeCaptions(workspaceId, target, controller.signal, captionLanguage);

      if (!controller.signal.aborted) callbacks.current.onConfirmCaptions(captions);
    } catch (failure) {
      if (controller.signal.aborted) return;
      const error = failure instanceof AudioTranscriptionError ? failure : new AudioTranscriptionError('youtubeCaptionsFailed', failure);

      setCaptionError(error);
    } finally {
      if (!controller.signal.aborted) {
        importRequest.current = undefined;
        setImporting(false);
      }
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open && !importing) onClose(); }}>
      <DialogContent
        container={document.getElementById('body')}
        className='ai-meeting-url-dialog max-h-[90vh] w-[440px] overflow-y-auto rounded-2xl border-0 p-0 shadow-dialog'
        closeButtonClassName='right-5 top-4 h-7 w-7 p-1'
        closeLabel={t('button.close')}
        showCloseButton={!importing}
        onEscapeKeyDown={(event) => { if (importing) event.preventDefault(); }}
        onInteractOutside={(event) => { if (importing) event.preventDefault(); }}
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
              disabled={importing}
              aria-label={t('document.aiMeeting.import.pasteUrl')}
              placeholder={t('document.aiMeeting.import.urlPlaceholder')}
              className={cn('w-full border border-border-primary bg-transparent px-2 text-sm leading-5 outline-none placeholder:text-text-tertiary focus:border-border-theme-thick', videoId ? 'h-10 rounded-[10px]' : 'h-8 rounded-lg')}
              value={url}
              onChange={(event) => {
                edited.current = true;
                setUrl(event.target.value);
                setTouched(false);
                setCaptionError(undefined);
                setSelectedLanguage(undefined);
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
            {availableLanguages && availableLanguages.length > 1 && (
              <label className='flex flex-col gap-1 text-xs leading-[18px] text-text-secondary'>
                {t('document.aiMeeting.import.captionLanguage')}
                <select
                  className='h-8 rounded-lg border border-border-primary bg-surface-primary px-2 text-sm text-text-primary'
                  value={captionLanguage}
                  disabled={importing}
                  onChange={(event) => {
                    setSelectedLanguage(event.target.value);
                    setCaptionError(undefined);
                  }}
                >
                  {availableLanguages.map((track) => (
                    <option key={track.code} value={track.code}>
                      {track.name}{track.isAutoGenerated && !/\bauto[- ]generated\b/i.test(track.name) ? ` (${t('document.aiMeeting.import.autoGeneratedCaptions')})` : ''}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {errorCode && (
              <p id={errorId} role='alert' className='text-xs leading-[18px] text-text-error'>
                {t(`document.aiMeeting.import.errors.${errorCode}`)}
                {!importing && activeError && isTransientImportError(errorCode) && <>{' '}<button type='button' className='font-medium underline' onClick={() => {
                  if (captionError) void confirm();
                  else setMetadataAttempt((previous) => previous + 1);
                }}>{t('document.aiMeeting.import.retry')}</button></>}
              </p>
            )}
            {errorDetails && (
              <details className='text-xs leading-[18px] text-text-tertiary'>
                <summary className='cursor-pointer'>{t('document.aiMeeting.import.showDetails')}</summary>
                <code className='break-all'>{errorDetails}</code>
              </details>
            )}
            {showUploadFallback && onUpload && (
              <div className='flex flex-col gap-3 border-t border-border-primary pt-3'>
                <p className='text-xs leading-[18px] text-text-secondary'>{t('document.aiMeeting.import.youtubeUploadFallback')}</p>
                <Button
                  type='button'
                  variant={canImportCaptions ? 'outline' : 'default'}
                  className='h-8 self-start font-medium'
                  disabled={importing || mediaDisabled}
                  onClick={onUpload}
                >
                  {t('document.aiMeeting.import.uploadAudioVideo')}
                </Button>
                {mediaDisabled && <p className='text-xs leading-[18px] text-text-secondary'>{t('document.aiMeeting.import.youtubeMediaUnavailable')}</p>}
              </div>
            )}
            {importing && (
              <p role='status' className='text-xs leading-[18px] text-text-secondary'>
                {t('document.aiMeeting.import.youtubeImportingCaptions')}
              </p>
            )}
          </div>
          <DialogFooter className='m-0 flex-row justify-end gap-3 px-5 pb-4'>
            {importing && <Button type='button' variant='outline' className='mr-auto h-8 font-medium' onClick={() => {
              importRequest.current?.abort();
              importRequest.current = undefined;
              setCaptionError(undefined);
              setImporting(false);
            }}>{t('document.aiMeeting.import.stop')}</Button>}
            <Button type='button' variant='outline' className='h-8 font-medium' disabled={importing} onClick={onClose}>
              {t('button.cancel')}
            </Button>
            {(!showUploadFallback || canImportCaptions) && <Button type='submit' className='h-8 font-medium' disabled={!valid}>
              {importing ? t('document.aiMeeting.import.youtubeImportingCaptions') : t(`document.aiMeeting.import.${videoId ? 'importCaptions' : 'transcribe'}`)}
            </Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
