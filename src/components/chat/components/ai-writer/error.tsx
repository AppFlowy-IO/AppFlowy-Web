import { useTranslation } from 'react-i18next';

import { ReactComponent as ErrorIcon } from '@/assets/icons/error.svg';
import { ERROR_CODE_NO_LIMIT } from '@/components/chat/lib/const';
import { useWriterContext } from '@/components/chat/writer/context';

export function Error() {
  const { t } = useTranslation();

  const { error, rewrite } = useWriterContext();

  return (
    <div className={'writer-anchor flex bg-background w-full justify-between p-2 rounded-lg max-w-full border border-input shadow-toast items-center gap-2'}>
      <div className={'flex text-foreground/70 text-sm items-center gap-2 p-2'}>
        <ErrorIcon className={'text-icon-error-thick'} />
        {error?.code === undefined ? <span>
          {t('chat.writer.errors.connection')}
          <span
            className={'hover:underline mx-1 text-primary cursor-pointer'}
            onClick={() => {
              rewrite();
            }}
          >{t('chat.writer.button.retry')}</span>
        </span> : error?.code === ERROR_CODE_NO_LIMIT ? t('chat.writer.errors.noLimit') : error?.message}
      </div>

    </div>
  );
}