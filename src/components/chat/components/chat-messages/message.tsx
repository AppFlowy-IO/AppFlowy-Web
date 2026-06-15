import { motion } from 'framer-motion';
import { useCallback, useMemo } from 'react';

import { MESSAGE_VARIANTS } from '@/components/chat/lib/animations';
import { useMessageAnimation } from '@/components/chat/provider/message-animation-provider';
import { useChatMessagesContext } from '@/components/chat/provider/messages-provider';
import { useSelectionModeContext } from '@/components/chat/provider/selection-mode-provider';
import { AuthorType, User } from '@/components/chat/types';
import { cn } from '@/lib/utils';

import { AIAnswer } from '../chat-messages/ai-answer';
import { AssistantMessage } from '../chat-messages/assistant-message';
import HumanQuestion from '../chat-messages/human-question';


export const Message = ({
  id,
  isHovered,
  fetchMember,
}: {
  id: number;
  isHovered: boolean;
  fetchMember: (uuid: string) => Promise<User>;
}) => {
  const { animatingIds, completeAnimation } = useMessageAnimation();
  const shouldAnimate = animatingIds.has(id);
  const {
    getMessage,
  } = useChatMessagesContext();

  const {
    messages,
  } = useSelectionModeContext();

  const selected = useMemo(() => messages.find(message => {
    return message.message_id === id;
  }), [id, messages]);

  const message = useMemo(() => getMessage(id), [id, getMessage]);

  const renderMessage = useCallback(() => {
    if(!message) {
      return null;
    }

    const authorType = message.author.author_type;

    switch(authorType) {
      case AuthorType.AI:
        return <AIAnswer
          content={message.content}
          id={message.message_id}
          sources={message.meta_data}
          isHovered={isHovered}
        />;
      case AuthorType.Assistant:
        return <AssistantMessage
          isHovered={isHovered}
          id={message.message_id}
        />;
      default:
        return <HumanQuestion
          fetchMember={fetchMember}
          userId={message.author.author_uuid}
          content={message.content}
        />;
    }

  }, [message, isHovered, fetchMember]);

  return (
    <motion.div
      data-message-id={id}
      initial={shouldAnimate ? 'hidden' : false}
      animate="visible"
      variants={MESSAGE_VARIANTS.getMessageVariants()}
      onAnimationComplete={() => shouldAnimate && completeAnimation(id)}
      className={cn(
        'message rounded-[8px] mb-9',
        selected ? 'bg-primary/5' : '',
      )}
    >
      {renderMessage()}
    </motion.div>
  );
};
