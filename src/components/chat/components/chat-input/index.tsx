import { motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ReactComponent as StopIcon } from '@/assets/icons/ai_stop_answering.svg';
import { ReactComponent as EarthIcon } from '@/assets/icons/earth.svg';
import { ReactComponent as SendIcon } from '@/assets/icons/filled_round_arrow_up.svg';
import { ReactComponent as AutoTextIcon } from '@/assets/icons/text.svg';
import { ReactComponent as ImageTextIcon } from '@/assets/icons/text_image.svg';
import { useChatContext } from '@/components/chat/chat/context';
import { FormatGroup } from '@/components/chat/components/ui/format-group';
import LoadingDots from '@/components/chat/components/ui/loading-dots';
import { Textarea } from '@/components/chat/components/ui/textarea';
import { MESSAGE_VARIANTS } from '@/components/chat/lib/animations';
import { useMessagesHandlerContext } from '@/components/chat/provider/messages-handler-provider';
import { usePromptModal } from '@/components/chat/provider/prompt-modal-provider';
import { useResponseFormatContext } from '@/components/chat/provider/response-format-provider';
import { ChatInputMode } from '@/components/chat/types';
import { AiPrompt } from '@/components/chat/types/prompt';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';


import { ModelSelector } from './model-selector';
import { PromptModal } from './prompt-modal';
import { RelatedViews } from './related-views';

const MAX_HEIGHT = 200;

export function ChatInput() {
  const { t } = useTranslation();
  const [focused, setFocused] = useState(false);
  const [message, setMessage] = useState('');

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  const { submitQuestion, cancelAnswerStream, answerApplying, questionSending, chatSettings, updateChatSettings } = useMessagesHandlerContext();
  const { responseFormat, responseMode, setResponseFormat, setResponseMode } = useResponseFormatContext();
  const { openModal, currentPromptId, updateCurrentPromptId, reloadDatabasePrompts } = usePromptModal();
  const { chatId } = useChatContext();

  const webSearchEnabled = chatSettings?.web_search_enabled ?? false;

  const handleToggleWebSearch = useCallback(() => {
    void updateChatSettings({ web_search_enabled: !webSearchEnabled });
  }, [webSearchEnabled, updateChatSettings]);

  const disabled = questionSending;

  useEffect(() => {
    return () => {
      setMessage('');
    };
  }, [chatId]);

  const adjustHeight = useCallback(() => {
    const textarea = textareaRef.current;

    if (!textarea) return;

    // reset height
    textarea.style.height = 'auto';

    // calculate height
    const newHeight = Math.min(textarea.scrollHeight, MAX_HEIGHT);

    textarea.style.height = `${newHeight}px`;

    // toggle overflowY
    textarea.style.overflowY = textarea.scrollHeight > MAX_HEIGHT ? 'auto' : 'hidden';

    // adjust container height
    if (containerRef.current) {
      containerRef.current.style.height = `${
        newHeight + (responseMode === ChatInputMode.FormatResponse ? 54 + 20 : 30 + 16)
      }px`; // 32px padding
    }
  }, [responseMode]);

  const handleInput = () => {
    adjustHeight();
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    adjustHeight();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handleSubmit = async () => {
    if (!message.trim()) {
      toast.error(`${t('chat.errors.emptyMessage')}`);
      return;
    }

    if (questionSending || answerApplying) {
      toast.error(`${t('chat.errors.wait')}`);
      return;
    }

    setMessage('');
    adjustHeight();

    try {
      await submitQuestion(message);
    } catch (e) {
      console.error(e);
    } finally {
      updateCurrentPromptId(null);
    }
  };

  useEffect(() => {
    const handleResize = () => {
      if (message) {
        adjustHeight();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [adjustHeight, message]);

  const formatTooltip =
    responseMode === ChatInputMode.FormatResponse ? t('chat.input.button.auto') : t('chat.input.button.format');
  const FormatIcon = responseMode === ChatInputMode.FormatResponse ? AutoTextIcon : ImageTextIcon;

  useEffect(() => {
    adjustHeight();
  }, [adjustHeight, currentPromptId, message]);

  const handleUsePrompt = useCallback(
    (prompt: AiPrompt) => {
      updateCurrentPromptId(prompt.id);
      setResponseMode(ChatInputMode.Auto);
      setMessage(prompt.content);
    },
    [setResponseMode, updateCurrentPromptId]
  );

  return (
    <motion.div
      variants={MESSAGE_VARIANTS.getInputVariants()}
      initial='hidden'
      animate='visible'
      exit='hidden'
      className={'w-full'}
    >
      <div
        ref={containerRef}
        className={`relative flex flex-col justify-between gap-1 border ${
          focused ? 'border-primary ring-1 ring-ring' : 'ring-0'
        } w-full rounded-[12px] border-border px-2 py-1 focus:border-primary`}
      >
        {responseMode === ChatInputMode.FormatResponse && (
          <FormatGroup
            setOutputLayout={(newOutLayout) => {
              setResponseFormat({
                ...responseFormat,
                output_layout: newOutLayout,
              });
            }}
            setOutputContent={(newOutContent) => {
              setResponseFormat({
                ...responseFormat,
                output_content: newOutContent,
              });
            }}
            outputContent={responseFormat.output_content}
            outputLayout={responseFormat.output_layout}
          />
        )}
        <Textarea
          autoFocus
          value={message}
          onChange={handleChange}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
          ref={textareaRef}
          onFocus={() => {
            setFocused(true);
          }}
          placeholder={t('chat.input.placeholder')}
          onBlur={() => {
            setFocused(false);
          }}
          rows={1}
          className={
            'h-full min-h-[32px] w-full resize-none !border-none !px-1.5 !py-1 !text-sm caret-primary !shadow-none !outline-none !ring-0'
          }
        />

        <div className={'flex items-center justify-between gap-4'}>
          <div className={'flex items-center gap-1'}>
            <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                variant={'ghost'}
                size={'icon'}
                data-testid='chat-input-format-toggle'
                onClick={() => {
                  setResponseMode(
                    responseMode === ChatInputMode.FormatResponse ? ChatInputMode.Auto : ChatInputMode.FormatResponse
                  );
                }}
                >
                  <FormatIcon className='text-icon-secondary h-5 w-5' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {formatTooltip}
              </TooltipContent>
            </Tooltip>

            <ModelSelector className={'h-7'} disabled={questionSending || answerApplying} />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  variant={'ghost'}
                  size={'icon'}
                  data-testid='chat-input-web-search-toggle'
                  onClick={handleToggleWebSearch}
                >
                  <EarthIcon className={`h-5 w-5 ${webSearchEnabled ? 'text-primary' : 'text-icon-secondary'}`} />
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {webSearchEnabled ? t('chat.webSearch.active') : t('chat.webSearch.label')}
              </TooltipContent>
            </Tooltip>

            <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                variant={'ghost'}
                className={'h-7 text-xs text-text-secondary'}
                data-testid='chat-input-browse-prompts'
                onClick={() => {
                  reloadDatabasePrompts();
                  openModal();
                }}
              >
                  {t('chat.customPrompt.browsePrompts')}
                </Button>
              </TooltipTrigger>
              <TooltipContent>
                {t('chat.customPrompt.browsePrompts')}
              </TooltipContent>
            </Tooltip>

            <PromptModal
              onUsePrompt={handleUsePrompt}
              returnFocus={() => {
                setFocused(true);
                setTimeout(() => {
                  textareaRef.current?.focus();
                }, 200);
              }}
            />
          </div>

          <div className={'flex items-center gap-2'}>
            <RelatedViews />
            {answerApplying ? (
              <Button onClick={cancelAnswerStream} size={'icon'} variant={'link'} className={'text-fill-theme-thick p-0'}>
                <StopIcon className='h-7 w-7' />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                size={'icon'}
                variant={'link'}
                className={'text-fill-theme-thick p-0'}
                disabled={!message.trim() || disabled}
                data-testid='chat-input-send'
              >
                {questionSending ? (
                  <LoadingDots />
                ) : (
                  <SendIcon className='h-7 w-7' />
                )}
              </Button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
