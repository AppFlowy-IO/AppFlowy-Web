import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import {
  AudioTranscriptionError,
  TRANSCRIPTION_FILE_ACCEPT,
} from '@/application/integrations/transcription-media';
import { TRANSCRIPT_LANGUAGES, transcriptLanguageDisplayCode } from '@/application/integrations/transcription-result';
import { readTranscriptionClipboard } from '@/application/integrations/youtube-audio';
import ProIcon from '@/assets/ai-transcript/pro.svg?url';
import ProgressIcon from '@/assets/ai-transcript/progress.svg?url';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as ErrorIcon } from '@/assets/icons/error.svg';
import { ReactComponent as TriangleDownIcon } from '@/assets/icons/triangle_down.svg';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from '@/components/ui/dialog';

import { AIMeetingUrlDialog } from './AIMeetingUrlDialog';
import { AIMeetingImportState } from './useAIMeetingImport';

export { AIMeetingUrlDialog } from './AIMeetingUrlDialog';

export function AIMeetingTranscriptLanguage({
  value,
  disabled,
  onChange,
}: {
  value: string;
  disabled: boolean;
  onChange: (language: string) => void;
}) {
  const { t } = useTranslation();

  return (
    <div className='relative inline-flex h-8 min-w-16 items-center justify-center gap-1 rounded-lg px-2 py-1.5 text-sm font-medium leading-5 text-text-secondary focus-within:ring-1 focus-within:ring-border-theme-thick'>
      <span aria-hidden='true'>{transcriptLanguageDisplayCode(value)}</span>
      <TriangleDownIcon className='h-5 w-3' aria-hidden='true' />
      <select
        aria-label={t('document.aiMeeting.import.language')}
        className='absolute inset-0 h-full w-full cursor-pointer opacity-0 disabled:cursor-default'
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      >
        {!TRANSCRIPT_LANGUAGES.some((language) => language === value) && (
          <option value={value}>{transcriptLanguageDisplayCode(value)}</option>
        )}
        {TRANSCRIPT_LANGUAGES.map((language) => (
          <option key={language} value={language}>
            {t(`document.aiMeeting.import.languages.${language}`)}
          </option>
        ))}
      </select>
    </div>
  );
}

export function AIMeetingWelcome({
  disabled,
  uploadDisabled = false,
  onPasteUrl,
  onUpload,
}: {
  disabled: boolean;
  uploadDisabled?: boolean;
  onPasteUrl: () => void;
  onUpload: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div className='ai-meeting-welcome flex flex-col items-center gap-4 px-4 py-5 text-center' contentEditable={false}>
      <p className='text-base font-semibold leading-[22px]'>{t('document.aiMeeting.import.welcome')}</p>
      <div className='flex max-w-full flex-col items-center gap-2'>
        <Button
          type='button'
          variant='outline'
          className='h-8 w-[200px] max-w-full rounded-lg font-medium'
          disabled={disabled || uploadDisabled}
          onClick={onUpload}
        >
          {t('document.aiMeeting.import.upload')}
        </Button>
        <Button
          type='button'
          variant='outline'
          className='h-8 w-[200px] max-w-full rounded-lg font-medium'
          disabled={disabled}
          onClick={onPasteUrl}
        >
          {t('document.aiMeeting.import.pasteUrl')}
        </Button>
        <p className='text-xs leading-[18px] tracking-[0.1px] text-text-secondary'>
          {t('document.aiMeeting.import.supportedTypes')}
        </p>
      </div>
    </div>
  );
}

export function AIMeetingErrorBanner({
  message,
  onRetry,
  onUpgrade,
  upgradePending = false,
  onDismiss,
  dismissLabel,
}: {
  message: string;
  onRetry?: () => void;
  onUpgrade?: () => void;
  upgradePending?: boolean;
  onDismiss?: () => void;
  dismissLabel?: string;
}) {
  const { t } = useTranslation();

  return (
    <div
      role='alert'
      className='ai-meeting-error mx-4 my-2 flex min-h-[44px] items-center gap-2 rounded-lg bg-fill-error-light px-4 py-2 text-sm leading-5'
      contentEditable={false}
    >
      <ErrorIcon className='h-5 w-5 shrink-0 text-icon-error-thick' aria-hidden='true' />
      <p className='min-w-0 flex-1 break-words'>
        {message}
        {(onUpgrade || onRetry) && (
          <>
            {' '}
            {t('document.aiMeeting.import.clickTo')}{' '}
            <button
              type='button'
              className='font-bold underline underline-offset-2 disabled:cursor-wait disabled:opacity-50'
              onClick={onUpgrade ?? onRetry}
              disabled={Boolean(onUpgrade && upgradePending)}
              aria-busy={onUpgrade ? upgradePending : undefined}
            >
              {t(onUpgrade ? 'document.aiMeeting.import.upgrade' : 'document.aiMeeting.import.retry')}
              {onUpgrade && upgradePending && (
                <img src={ProgressIcon} alt='' className='ml-1 inline-block h-3.5 w-3.5 animate-spin align-text-bottom motion-reduce:animate-none' />
              )}
            </button>
            .
          </>
        )}
      </p>
      {onDismiss && (
        <Button
          type='button'
          size='icon-lg'
          variant='ghost'
          aria-label={dismissLabel ?? t('document.aiMeeting.import.dismissError')}
          onClick={onDismiss}
        >
          <CloseIcon className='h-5 w-5' />
        </Button>
      )}
    </div>
  );
}

const PROCESSING_MESSAGE_KEYS = [
  'processingFile', 'analyzingContent', 'workingOnFile', 'optimizingInput', 'organizingData', 'almostReady',
] as const;
const SUMMARY_MESSAGE_KEYS = [
  'generatingSummary', 'analyzingContent', 'distillingInformation', 'craftingSummary',
] as const;

export function AIMeetingImportProgress({
  stage,
  progress,
}: {
  stage: AIMeetingImportState['stage'] | 'summarizing';
  progress?: number;
}) {
  const { t } = useTranslation();
  const [tick, setTick] = useState(0);

  useEffect(() => {
    setTick(0);
    if (stage !== 'analyzing' && stage !== 'summarizing') return;
    const timer = setInterval(() => setTick((previous) => previous + 1), 1000);

    return () => clearInterval(timer);
  }, [stage]);

  // Flutter repeats each four-second dot cycle twice before changing the message.
  const messages = stage === 'summarizing' ? SUMMARY_MESSAGE_KEYS : PROCESSING_MESSAGE_KEYS;
  const messageIndex = Math.floor(tick / 8) % messages.length;
  const isProcessing = stage === 'analyzing' || stage === 'summarizing';
  const message = isProcessing
    ? t(`document.aiMeeting.import.loading.${messages[messageIndex]}`)
    : stage === 'uploading' && progress !== undefined
      ? t('document.aiMeeting.import.uploading', { percent: Math.floor(progress * 100) })
      : t('document.aiMeeting.import.checking');

  return (
    <div
      role='status'
      aria-live='polite'
      className='ai-meeting-import-progress flex items-start gap-1.5 px-4 pb-4 pt-2 text-base font-normal leading-[22px] text-text-tertiary'
      contentEditable={false}
    >
      <img
        src={ProgressIcon}
        alt=''
        width={24}
        height={24}
        className='shrink-0 animate-spin motion-reduce:animate-none'
      />
      <span key={`${stage}:${messageIndex}`} className='animate-in fade-in duration-[250ms] motion-reduce:animate-none'>
        {message}
        {isProcessing && <span aria-hidden='true'>{'.'.repeat(tick % 4)}</span>}
      </span>
    </div>
  );
}

export function AIMeetingPromotionBanner({ onUpgrade, onDismiss }: { onUpgrade: () => void; onDismiss: () => void }) {
  const { t } = useTranslation();

  return (
    <div
      className='ai-meeting-promotion flex min-h-[48px] items-center gap-2 bg-fill-featured-light px-4 py-2 text-sm leading-5 text-text-featured'
      contentEditable={false}
    >
      <img src={ProIcon} alt='' width={12} height={18} className='shrink-0' />
      <p className='min-w-0 flex-1'>
        <button
          type='button'
          className='font-bold underline underline-offset-2'
          aria-label={t('document.aiMeeting.import.upgradeToPro')}
          onClick={onUpgrade}
        >
          {t('document.aiMeeting.import.upgrade')}
        </button>{' '}
        {t('document.aiMeeting.import.promotion')}
      </p>
      <Button
        type='button'
        variant='ghost'
        size='icon-lg'
        className='rounded-lg p-1.5'
        aria-label={t('document.aiMeeting.import.dismissPromotion')}
        onClick={onDismiss}
      >
        <CloseIcon className='h-5 w-5' />
      </Button>
    </div>
  );
}

export function AIMeetingUpgradeBanner({ onDismiss }: { onDismiss: () => void }) {
  const [, setSearch] = useSearchParams();

  return (
    <AIMeetingPromotionBanner
      onDismiss={onDismiss}
      onUpgrade={() =>
        setSearch((previous) => {
          const next = new URLSearchParams(previous);

          next.set('action', 'change_plan');
          return next;
        })
      }
    />
  );
}

export function AIMeetingImportActions({ state, showWelcome }: { state: AIMeetingImportState; showWelcome: boolean }) {
  const { t } = useTranslation();
  const input = useRef<HTMLInputElement>(null);
  const [urlOpen, setUrlOpen] = useState(false);
  const [clipboardText, setClipboardText] = useState<Promise<string>>();
  const [sizeDialogOpen, setSizeDialogOpen] = useState(false);
  const sizeLimit = state.error instanceof AudioTranscriptionError ? state.error.maxBytes : undefined;

  useEffect(() => {
    setSizeDialogOpen(state.errorCode === 'fileTooLarge');
  }, [state.error, state.errorCode]);
  useEffect(() => {
    if (!state.available) setUrlOpen(false);
  }, [state.available]);

  return (
    <>
      <input
        ref={input}
        type='file'
        className='hidden'
        tabIndex={-1}
        aria-label={t('document.aiMeeting.import.upload')}
        accept={TRANSCRIPTION_FILE_ACCEPT}
        disabled={!state.available || state.busy || state.quotaExceeded}
        onChange={(event) => {
          const file = event.target.files?.[0];

          event.target.value = '';
          if (file && state.available && !state.busy && !state.quotaExceeded) void state.importSource(file);
        }}
      />
      {showWelcome && (
        <AIMeetingWelcome
          disabled={!state.available || state.busy}
          uploadDisabled={state.quotaExceeded}
          onUpload={() => input.current?.click()}
          onPasteUrl={() => {
            setClipboardText(readTranscriptionClipboard());
            setUrlOpen(true);
          }}
        />
      )}
      {urlOpen && (
        <AIMeetingUrlDialog
          workspaceId={state.workspaceId}
          language={state.language}
          mediaDisabled={!state.available || state.busy || state.quotaExceeded}
          maxBytes={state.usage?.single_upload_unlimited ? undefined : state.usage?.single_upload_limit}
          clipboardText={clipboardText}
          onFailure={state.reportError}
          onClose={() => setUrlOpen(false)}
          onUpload={() => {
            if (!state.available || state.busy || state.quotaExceeded) return;
            setUrlOpen(false);
            input.current?.click();
          }}
          onConfirmCaptions={(captions) => {
            setUrlOpen(false);
            state.importCaptions(captions);
          }}
          onConfirm={(source) => {
            setUrlOpen(false);
            void state.importSource(source);
          }}
        />
      )}
      <Dialog
        open={sizeDialogOpen}
        onOpenChange={(open) => {
          setSizeDialogOpen(open);
          if (!open) state.dismissError();
        }}
      >
        <DialogContent
          container={document.getElementById('body')}
          size='sm'
          className='rounded-2xl border-0 p-0'
          closeButtonClassName='right-5 top-4 h-7 w-7 p-1'
          closeLabel={t('button.close')}
        >
          <DialogTitle className='min-h-[44px] px-5 pr-14 pt-4 text-base font-bold leading-[22px]'>
            {t('document.aiMeeting.import.fileSizeTitle')}
          </DialogTitle>
          <DialogDescription className='min-h-[92px] px-5 pb-5 pt-3 text-sm leading-5'>
            {t('document.aiMeeting.import.fileSizeDescription', {
              megabytes: Math.round((sizeLimit ?? 0) / 1024 / 1024),
            })}
          </DialogDescription>
          <DialogFooter className='m-0 flex-row justify-end gap-3 px-5 pb-4'>
            <Button
              type='button'
              variant='outline'
              className='h-8 font-medium'
              onClick={() => {
                setSizeDialogOpen(false);
                state.dismissError();
              }}
            >
              {t('button.cancel')}
            </Button>
            <Button
              type='button'
              className='h-8 font-medium'
              onClick={() => {
                setSizeDialogOpen(false);
                state.dismissError();
                input.current?.click();
              }}
            >
              {t('document.aiMeeting.import.reupload')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
