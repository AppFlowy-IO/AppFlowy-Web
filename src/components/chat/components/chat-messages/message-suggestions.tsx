import { motion } from 'framer-motion';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ChatIcon } from '@/assets/icons/chat_suggestion.svg';
import { useChatContext } from '@/components/chat/chat/context';
import { MESSAGE_VARIANTS } from '@/components/chat/lib/animations';
import { useMessagesHandlerContext } from '@/components/chat/provider/messages-handler-provider';
import { Suggestions } from '@/components/chat/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';


interface MessageSuggestionsProps {
  suggestions: Suggestions;
}

const EmptySuggestions = () => {
  return (
    <div className={'flex flex-col gap-4 w-full overflow-hidden mr-auto'}>
      <Label>No suggestions</Label>
    </div>
  );
};

export function MessageSuggestions({ suggestions }: MessageSuggestionsProps) {
  const { t } = useTranslation();
  const { selectionMode } = useChatContext();
  const { submitQuestion } = useMessagesHandlerContext();

  const handleClick = async (content: string) => {
    try {
      await submitQuestion(content);
    } catch (e) {
      console.error(e);
    }
  };

  if (selectionMode) {
    return null;
  }

  return (
    <motion.div
      initial={'hidden'}
      animate="visible"
      variants={MESSAGE_VARIANTS.getSuggestionsVariants()}
      className={'flex flex-col gap-4 w-full overflow-hidden mr-auto mt-9'}
    >
      <Label>{t('chat.suggestion.title')}</Label>
      <div className={'flex gap-2 flex-col items-start w-full overflow-hidden'}>
        {suggestions.items.length === 0 ? (
          <EmptySuggestions />
        ) : (
          suggestions.items.map((suggestion, index) => (
            <Button
              key={index}
              className={'w-full justify-start overflow-hidden h-fit p-2'}
              onClick={() => handleClick(suggestion.content)}
              variant={'ghost'}
            >
              <ChatIcon className='w-5 h-5 text-fill-theme-thick' />
              <span className={'text-wrap !text-foreground/85 text-start'}>{suggestion.content}</span>
            </Button>
          ))
        )}
      </div>
    </motion.div>
  );
}
