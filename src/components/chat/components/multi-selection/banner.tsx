import { CheckSquare, Minus, Square, X } from 'lucide-react';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { useChatContext } from '@/components/chat/chat/context';
import { AddMessageToPageWrapper } from '@/components/chat/components/add-messages-to-page-wrapper';
import { ChatMessage } from '@/components/chat/types';
import { CheckStatus } from '@/components/chat/types/checkbox';
import { Button } from '@/components/ui/button';


export function Banner({
  onSelectAll,
  onClearAll,
  checkStatus,
  messages,
}: {
  checkStatus: CheckStatus
  onSelectAll: () => void;
  onClearAll: () => void;
  messages: ChatMessage[]
}) {
  const {
    selectionMode,
    onCloseSelectionMode,
  } = useChatContext();

  const { t } = useTranslation();

  const CheckboxIcon = useMemo(() => {
    switch(checkStatus) {
      case CheckStatus.Checked:
        return <CheckSquare className="h-4 w-4" />;
      case CheckStatus.Indeterminate:
        return <Square className="h-4 w-4"><Minus className="h-3 w-3" /></Square>;
      default:
        return <Square className="h-4 w-4" />;
    }
  }, [checkStatus]);

  const handleClick = () => {
    if(checkStatus === CheckStatus.Checked) {
      onClearAll();
    } else {
      onSelectAll();
    }
  };

  if(!selectionMode) return null;

  return (
    <div className={'flex fixed z-[100] left-0 top-0 w-full h-12 bg-primary/90 px-6 text-primary-foreground chat-selections-banner items-center gap-2 justify-between'}>
      <div className={'flex items-center gap-2'}>
        <Button
          variant={'link'}
          onClick={handleClick}
          className={'w-4 h-4 text-accent'}
        >
          {CheckboxIcon}
        </Button>

        <div className={'text-sm font-medium'}>
          {messages.length > 0 ? t('chat.addMessageToPage.selectedCount', {
            count: messages.length,
          }) : t('chat.addMessageToPage.selectMsg')}
        </div>
      </div>
      <div className={'flex items-center justify-end gap-2'}>
        <AddMessageToPageWrapper
          onFinished={onCloseSelectionMode}
          messages={messages}
        >
          <Button
            variant={'outline'}
            className={'text-primary-foreground h-[28px] px-3 text-sm bg-transparent hover:bg-primary hover:text-primary-foreground'}
          >
            {t('chat.button.addTo')}
          </Button>
        </AddMessageToPageWrapper>
        <Button
          variant={'link'}
          onClick={onCloseSelectionMode}
          className={'w-5 h-5 text-accent'}
        >
          <X className={'w-4 h-4'} />
        </Button>
      </div>
    </div>
  );
}

