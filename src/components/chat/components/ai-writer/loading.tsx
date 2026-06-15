import { useTranslation } from 'react-i18next';

import { ReactComponent as StopIcon } from '@/assets/icons/ai_stop_answering.svg';
import LoadingDots from '@/components/chat/components/ui/loading-dots';
import { useWriterContext } from '@/components/chat/writer/context';
import { Button } from '@/components/ui/button';

export function Loading() {
  const { t } = useTranslation();
  const {
    isApplying,
    isFetching,
    stop,
  } = useWriterContext();

  return (
    <div className={'writer-anchor flex bg-background w-full justify-between p-2 rounded-lg max-w-full border border-input shadow-toast items-center gap-2'}>
      <div className={'flex text-foreground/70 text-xs items-center gap-2 px-2'}>
        {
          isFetching ? t('chat.writer.analyzing') : isApplying ? t('chat.writer.editing') : null
        }
        <LoadingDots size={20} />
      </div>

      <Button
        onMouseDown={e => {
          e.preventDefault();
        }}
        tabIndex={-1}
        onClick={stop}
        size={'icon'}
        variant={'link'}
        className={'text-fill-theme-thick p-0'}
      >
        <StopIcon className='h-7 w-7'/>
      </Button>
    </div>
  );
}