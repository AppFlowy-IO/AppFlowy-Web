import { motion } from 'framer-motion';
import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as ChevronDown } from '@/assets/icons/triangle_down.svg';
import { MESSAGE_VARIANTS } from '@/components/chat/lib/animations';
import { AIAssistantType } from '@/components/chat/types';
import { useWriterContext } from '@/components/chat/writer/context';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

import { AiWriterMenuContent } from '../ai-writer/ai-writer-menu-content';




export function WritingMore({ input }: {
  input: string
}) {
  const { t } = useTranslation();
  const {
    isGlobalDocument,
  } = useWriterContext();

  const [open, setOpen] = useState(false);

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const isFilterOut = useCallback((type: AIAssistantType) => {
    if(isGlobalDocument) {
      return type !== AIAssistantType.ContinueWriting;
    }

    return type === AIAssistantType.AskAIAnything || type === AIAssistantType.ContinueWriting;
  }, [isGlobalDocument]);

  return <Popover
    onOpenChange={setOpen}
    open={open}
    modal={false}
  >
    <PopoverTrigger asChild>
      <Button
        className={'text-xs !gap-1 !text-text-secondary h-[28px]'}
        size={'sm'}
        variant={'ghost'}
      >
        <div className={'flex gap-0.5 items-center flex-1'}>
          {t('chat.writer.button.more')}
          <ChevronDown className='w-3 h-5' />
        </div>

      </Button>
    </PopoverTrigger>
    <PopoverContent asChild className={'min-w-[240px] !p-2'}>
      <motion.div
        variants={MESSAGE_VARIANTS.getSelectorVariants()}
        initial="hidden"
        animate={open ? "visible" : "exit"}
        className={'min-w-[240px] p-2 bg-popover border border-border-primary shadow-md'}
      >
        <AiWriterMenuContent
          input={input}
          isFilterOut={isFilterOut}
          onClicked={handleClose}
        />
      </motion.div>
    </PopoverContent>
  </Popover>;
}