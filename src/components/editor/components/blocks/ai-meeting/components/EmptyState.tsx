import { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { Button } from '@/components/ui/button';

interface EmptyStateProps {
  onNewNotes?: () => void;
  onUploadAudio?: () => void;
  readOnly?: boolean;
}

export const EmptyState = memo(({ onNewNotes: _onNewNotes, onUploadAudio, readOnly = false }: EmptyStateProps) => {
  const { t } = useTranslation();

  return (
    <div className="flex flex-col items-center justify-center px-4 py-5 gap-4">
      <p className="text-base font-semibold leading-[22px] text-text-primary text-center">
        {t('aiMeeting.empty.title', 'Get organized, share-ready notes from every meeting')}
      </p>
      {!readOnly && (
        <div className="flex flex-col items-center gap-2">
          {/* TODO(nathan): Re-enable New AI meeting notes button when feature is ready */}
          {/* {onNewNotes && (
            <Button
              onClick={onNewNotes}
              className="w-[200px] bg-fill-theme-thick text-text-on-fill hover:bg-fill-theme-thick/90"
            >
              {t('aiMeeting.empty.newNotes', 'New AI meeting notes')}
            </Button>
          )} */}
          {onUploadAudio && (
            <Button
              variant="outline"
              onClick={onUploadAudio}
              className="w-[200px]"
            >
              {t('aiMeeting.empty.transcribeAudio', 'Transcribe audio file')}
            </Button>
          )}
          <p className="text-xs leading-[18px] tracking-[0.1px] text-text-secondary text-center">
            {t('aiMeeting.empty.supportedTypes', 'Supported file types: mp3, mp4, mpeg, mpga, m4a, wav, webm')}
          </p>
        </div>
      )}
    </div>
  );
});

EmptyState.displayName = 'EmptyState';
