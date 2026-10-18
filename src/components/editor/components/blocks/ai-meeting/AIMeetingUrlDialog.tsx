import { useEffect, useId, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AudioTranscriptionSource } from '@/application/integrations/audio-file-transcription';
import { AudioTranscriptionError, isDirectMediaUrl, isServiceImportError, isTransientImportError } from '@/application/integrations/transcription-media';
import { getYoutubeCaptions, getYoutubeAudioMetadata, importErrorDetails, readTranscriptionClipboard } from '@/application/integrations/youtube-audio';
import { detectYoutubeExtension, isYoutubeExtensionAvailable } from '@/application/integrations/youtube-extension';
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
  maxBytes?: number;
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
  maxBytes,
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
  const [importStage, setImportStage] = useState<'captions' | 'audio'>();
  const [selectedLanguage, setSelectedLanguage] = useState<string>();
  const [captionError, setCaptionError] = useState<AudioTranscriptionError>();
  const [downloadError, setDownloadError] = useState<AudioTranscriptionError>();
  const [downloadProgress, setDownloadProgress] = useState<number>();
  const [extensionAvailable, setExtensionAvailable] = useState(isYoutubeExtensionAvailable);
  const [checkingExtension, setCheckingExtension] = useState(false);
  const [extensionAttempt, setExtensionAttempt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const importRequest = useRef<AbortController>();
  const edited = useRef(false);
  const callbacks = useRef({ onClose, onConfirm, onConfirmCaptions, onFailure, mediaDisabled });

  useEffect(() => {
    callbacks.current = { onClose, onConfirm, onConfirmCaptions, onFailure, mediaDisabled };
  }, [onClose, onConfirm, onConfirmCaptions, onFailure, mediaDisabled]);
  const errorId = useId();
  const target = url.trim();
  const videoId = youtubeVideoId(target);
  const current = preview?.url === target ? preview : undefined;
  const metadata = current?.metadata;
  const loading = Boolean(videoId && !current);
  const captionsUnavailable = metadata?.captionLanguages?.length === 0;
  const importing = importStage !== undefined;
  // AppFlowy-side failures hide the YouTube media fallback: downloading audio would hit the same outage.
  const youtubeFailure = (error?: AudioTranscriptionError) => Boolean(error && !isServiceImportError(error.code));
  const showMediaFallback = Boolean(videoId && (captionsUnavailable || youtubeFailure(captionError) || youtubeFailure(current?.error) || downloadError || importStage === 'audio'));
  const canImportCaptions = Boolean(metadata && !captionsUnavailable);
  const availableLanguages = metadata?.captionLanguages;
  const preferredLanguage = availableLanguages?.find((track) => track.code.toLowerCase() === language?.toLowerCase())?.code
    ?? availableLanguages?.find((track) => track.code.split('-')[0] === language?.split('-')[0])?.code
    ?? availableLanguages?.[0]?.code;
  const captionLanguage = availableLanguages?.some((track) => track.code === selectedLanguage)
    ? selectedLanguage : preferredLanguage;
  const supported = Boolean(videoId) || isDirectMediaUrl(target);
  const valid = supported && (videoId ? canImportCaptions : !mediaDisabled) && !importing;
  const errorCode = downloadError?.code || captionError?.code || current?.error?.code || (captionsUnavailable ? 'youtubeCaptionsUnavailable' : undefined) ||
    (touched && target && !supported ? 'unsupportedUrl' : undefined);
  const activeError = downloadError ?? captionError ?? current?.error;
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
    if (!showMediaFallback || mediaDisabled) return;
    const controller = new AbortController();

    setCheckingExtension(true);
    void detectYoutubeExtension(controller.signal).then((available) => {
      if (!controller.signal.aborted) setExtensionAvailable(available);
    }).catch(() => {
      if (!controller.signal.aborted) setExtensionAvailable(false);
    }).finally(() => {
      if (!controller.signal.aborted) setCheckingExtension(false);
    });
    const checkOnFocus = () => setExtensionAttempt((previous) => previous + 1);

    window.addEventListener('focus', checkOnFocus);
    return () => {
      controller.abort();
      window.removeEventListener('focus', checkOnFocus);
    };
  }, [extensionAttempt, mediaDisabled, showMediaFallback]);
  useEffect(() => {
    if (!mediaDisabled || importStage !== 'audio') return;
    importRequest.current?.abort();
    importRequest.current = undefined;
    setImportStage(undefined);
    setDownloadProgress(undefined);
  }, [importStage, mediaDisabled]);
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
    setImportStage('captions');
    setCaptionError(undefined);
    setDownloadError(undefined);
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
        setImportStage(undefined);
      }
    }
  };

  const downloadAudio = async () => {
    if (!videoId || mediaDisabled || importRequest.current || !extensionAvailable) return;
    const controller = new AbortController();

    importRequest.current = controller;
    setImportStage('audio');
    setDownloadError(undefined);
    setDownloadProgress(undefined);
    try {
      const { downloadYoutubeAudioInBrowser } = await import('@/application/integrations/youtube-browser-download');

      if (controller.signal.aborted) return;
      const file = await downloadYoutubeAudioInBrowser({
        url: target,
        signal: controller.signal,
        maxBytes,
        onProgress: (progress) => {
          if (!controller.signal.aborted) setDownloadProgress(progress);
        },
      });

      if (!controller.signal.aborted && !callbacks.current.mediaDisabled) callbacks.current.onConfirm(file);
    } catch (failure) {
      if (controller.signal.aborted) return;
      const error = failure instanceof AudioTranscriptionError ? failure : new AudioTranscriptionError('youtubeDownloadFailed', failure);

      setDownloadError(error);
      if (error.code === 'youtubeExtensionRequired') setExtensionAvailable(false);
      if (error.code === 'fileTooLarge' && callbacks.current.onFailure) {
        callbacks.current.onFailure(error);
        callbacks.current.onClose();
      }
    } finally {
      if (!controller.signal.aborted) {
        importRequest.current = undefined;
        setImportStage(undefined);
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
                setDownloadError(undefined);
                setDownloadProgress(undefined);
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
                    setDownloadError(undefined);
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
                {!importing && activeError && isTransientImportError(errorCode) && <>{' '}<button type='button' className='font-medium underline disabled:opacity-50' disabled={Boolean(downloadError && (mediaDisabled || checkingExtension || !extensionAvailable))} onClick={() => {
                  if (downloadError) void downloadAudio();
                  else if (captionError) void confirm();
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
            {showMediaFallback && (
              <div className='flex flex-col gap-3 border-t border-border-primary pt-3'>
                <p className='text-xs leading-[18px] text-text-secondary'>{t('document.aiMeeting.import.youtubeAudioFallback')}</p>
                <div className='flex flex-wrap gap-2'>
                  <Button
                    type='button'
                    variant={canImportCaptions ? 'outline' : 'default'}
                    className='h-8 font-medium'
                    disabled={importing || mediaDisabled || checkingExtension || !extensionAvailable}
                    onClick={() => void downloadAudio()}
                  >
                    {t('document.aiMeeting.import.downloadAndTranscribe')}
                  </Button>
                  {onUpload && <Button type='button' variant='outline' className='h-8 font-medium' disabled={importing || mediaDisabled} onClick={onUpload}>
                    {t('document.aiMeeting.import.uploadAudioVideo')}
                  </Button>}
                </div>
                {checkingExtension && !mediaDisabled && !importing && <p role='status' className='text-xs leading-[18px] text-text-secondary'>{t('document.aiMeeting.import.youtubeExtensionChecking')}</p>}
                {mediaDisabled && <p className='text-xs leading-[18px] text-text-secondary'>{t('document.aiMeeting.import.youtubeMediaUnavailable')}</p>}
                {!extensionAvailable && !mediaDisabled && (
                  <details open className='text-xs leading-[18px] text-text-secondary'>
                    <summary className='cursor-pointer font-medium text-text-primary'>{t('document.aiMeeting.import.youtubeExtensionSetup')}</summary>
                    <p className='mt-2'>{t('document.aiMeeting.import.youtubeExtensionDescription')}</p>
                    <ol className='mt-2 list-decimal space-y-1 pl-5'>
                      <li><a href='/downloads/appflowy-youtube-transcript.zip' download className='font-medium text-text-action underline'>{t('document.aiMeeting.import.youtubeExtensionDownload')}</a>{' '}{t('document.aiMeeting.import.youtubeExtensionUnzip')}</li>
                      <li>{t('document.aiMeeting.import.youtubeExtensionLoad')}</li>
                      <li>{t('document.aiMeeting.import.youtubeExtensionReload')}</li>
                    </ol>
                    <Button type='button' variant='outline' className='mt-2 h-7 text-xs' disabled={checkingExtension || importing} onClick={() => setExtensionAttempt((previous) => previous + 1)}>
                      {t(checkingExtension ? 'document.aiMeeting.import.youtubeExtensionChecking' : 'document.aiMeeting.import.youtubeExtensionCheck')}
                    </Button>
                  </details>
                )}
              </div>
            )}
            {importing && (
              <p role='status' className='text-xs leading-[18px] text-text-secondary'>
                {importStage === 'captions' ? t('document.aiMeeting.import.youtubeImportingCaptions') : downloadProgress === undefined
                  ? t('document.aiMeeting.import.youtubePreparingDownload')
                  : t('document.aiMeeting.import.youtubeDownloadingAudio', { percent: Math.floor(downloadProgress * 100) })}
              </p>
            )}
          </div>
          <DialogFooter className='m-0 flex-row justify-end gap-3 px-5 pb-4'>
            {importing && <Button type='button' variant='outline' className='mr-auto h-8 font-medium' onClick={() => {
              importRequest.current?.abort();
              importRequest.current = undefined;
              if (importStage === 'captions') setCaptionError(undefined);
              setImportStage(undefined);
              setDownloadProgress(undefined);
              setDownloadError(undefined);
            }}>{t('document.aiMeeting.import.stop')}</Button>}
            <Button type='button' variant='outline' className='h-8 font-medium' disabled={importing} onClick={onClose}>
              {t('button.cancel')}
            </Button>
            {(!showMediaFallback || canImportCaptions) && <Button type='submit' className='h-8 font-medium' disabled={!valid}>
              {importStage === 'captions' ? t('document.aiMeeting.import.youtubeImportingCaptions') : t(`document.aiMeeting.import.${videoId ? 'importCaptions' : 'transcribe'}`)}
            </Button>}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
