import { useTranslation } from 'react-i18next';

import { ReactComponent as AddPageIcon } from '@/assets/icons/add_to_page.svg';
import { AddMessageToPageWrapper } from '@/components/chat/components/add-messages-to-page-wrapper';
import { useChatMessagesContext } from '@/components/chat/provider/messages-provider';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';


export function AddMessageTo({ id }: { id: number }) {
  const { getMessage } = useChatMessagesContext();

  const message = getMessage(id);
  const { t } = useTranslation();

  if (!message) return null;

  return (
    <Tooltip>
      <AddMessageToPageWrapper messages={[message]}>
        <TooltipTrigger asChild>
          <Button
            onMouseDown={(e) => {
              e.preventDefault();
            }}
            variant={'ghost'}
            size={'icon'}
          >
            <AddPageIcon className='h-5 w-5 text-icon-secondary' />
          </Button>
        </TooltipTrigger>
      </AddMessageToPageWrapper>
      <TooltipContent align={'center'} side={'bottom'}>
        {t('chat.button.addToPage')}
      </TooltipContent>
    </Tooltip>
  );
}

export default AddMessageTo;
