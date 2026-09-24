import { useTranslation } from 'react-i18next';

import { ReactComponent as ErrorIcon } from '@/assets/icons/error.svg';
import { useIsOfficialHosted } from '@/components/app/app.hooks';
import { ERROR_CODE_NO_LIMIT } from '@/components/chat/lib/const';
import { useWriterContext } from '@/components/chat/writer/context';

export function Error() {
  const { t } = useTranslation();
  const isOfficialHosted = useIsOfficialHosted();

  const { error, rewrite } = useWriterContext();

  return (
    <div
      className={
        'writer-anchor flex w-full max-w-full items-center justify-between gap-2 rounded-lg border border-input bg-background p-2 shadow-toast'
      }
    >
      <div className={'flex items-center gap-2 p-2 text-sm text-foreground/70'}>
        <ErrorIcon className={'text-icon-error-thick'} />
        {error?.code === undefined ? (
          <span>
            {t('chat.writer.errors.connection')}
            <span
              className={'mx-1 cursor-pointer text-primary hover:underline'}
              onClick={() => {
                rewrite();
              }}
            >
              {t('chat.writer.button.retry')}
            </span>
          </span>
        ) : error?.code === ERROR_CODE_NO_LIMIT && isOfficialHosted ? (
          t('chat.writer.errors.responseLimit')
        ) : (
          error?.message || t('chat.errors.responseUnavailable')
        )}
      </div>
    </div>
  );
}
