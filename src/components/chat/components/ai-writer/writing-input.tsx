import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ReactComponent as SendIcon } from '@/assets/icons/filled_round_arrow_up.svg';
import { ReactComponent as AutoTextIcon } from '@/assets/icons/text.svg';
import { ReactComponent as ImageTextIcon } from '@/assets/icons/text_image.svg';
import { ModelSelector } from '@/components/chat/components/chat-input/model-selector';
import { PromptModal } from '@/components/chat/components/chat-input/prompt-modal';
import { FormatGroup } from '@/components/chat/components/ui/format-group';
import LoadingDots from '@/components/chat/components/ui/loading-dots';
import { Textarea } from '@/components/chat/components/ui/textarea';
import { usePromptModal } from '@/components/chat/provider/prompt-modal-provider';
import { ChatInputMode } from '@/components/chat/types';
import { AiPrompt } from '@/components/chat/types/prompt';
import { useWriterContext } from '@/components/chat/writer/context';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import { ViewTree } from '../ai-writer/view-tree';
import { WritingMore } from '../ai-writer/writing-more';

const MAX_HEIGHT = 200;
// Prevent focus on page load and cause the page to scroll
const FOCUS_DELAY = 250;

export function WritingInput({
  onSubmit,
  noBorder,
  noSwitchMode,
}: {
  onSubmit: (message: string) => Promise<() => void>;
  noBorder?: boolean;
  noSwitchMode?: boolean;
}) {
  const { t } = useTranslation();

  const [, setFocused] = useState(false);
  const [message, setMessage] = useState('');
  const {
    assistantType,
    isApplying,
    isFetching,
    responseMode,
    responseFormat,
    setResponseFormat,
    setResponseMode,
    hasAIAnswer,
    scrollContainer,
  } = useWriterContext();
  const { openModal, currentPromptId, updateCurrentPromptId } = usePromptModal();

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (assistantType === undefined) {
      setMessage('');
    }
  }, [assistantType]);

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
        newHeight + (responseMode === ChatInputMode.FormatResponse ? 54 + 24 : 30 + 16)
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

    if (isFetching || isApplying) {
      toast.error(`${t('chat.errors.wait')}`);
      return;
    }

    setMessage('');
    adjustHeight();

    try {
      await onSubmit(message);
      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
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

  useEffect(() => {
    adjustHeight();
  }, [adjustHeight]);

  useEffect(() => {
    setTimeout(() => {
      const rect = textareaRef.current?.getBoundingClientRect();
      const containerRect = scrollContainer?.getBoundingClientRect();

      if (!rect || !containerRect) return;

      const inViewport = rect.top >= containerRect.top && rect.bottom <= containerRect.bottom;
      const bottomInView = rect.top < containerRect.top && rect.bottom > containerRect.top;
      const topInView = rect.bottom > containerRect.bottom && rect.top < containerRect.bottom;

      if (inViewport || bottomInView || topInView) {
        textareaRef.current?.focus();
        return;
      }

      console.error('Disable focus on page load', {
        rect,
        containerRect,
      });
    }, FOCUS_DELAY);
  }, [scrollContainer]);

  useEffect(() => {
    adjustHeight();
  }, [adjustHeight, currentPromptId]);

  const handleUsePrompt = useCallback(
    (prompt: AiPrompt) => {
      updateCurrentPromptId(prompt.id);
      setResponseMode(ChatInputMode.Auto);
      setMessage(prompt.content);
      if (textareaRef) {
        textareaRef.current?.focus();
        setFocused(true);
      }
    },
    [setResponseMode, updateCurrentPromptId]
  );

  const formatTooltip =
    responseMode === ChatInputMode.FormatResponse ? t('chat.input.button.auto') : t('chat.input.button.format');
  const FormatIcon = responseMode === ChatInputMode.FormatResponse ? AutoTextIcon : ImageTextIcon;

  return (
    <div className={cn('writer-anchor flex w-full flex-col', noBorder ? '' : 'pb-[150px]')}>
      <div
        ref={containerRef}
        style={{
          borderTop: noBorder ? 'none' : undefined,
          borderTopLeftRadius: noBorder ? 0 : undefined,
          borderTopRightRadius: noBorder ? 0 : undefined,
          border: noBorder ? 'none' : undefined,
        }}
        className={cn(
          noBorder ? '' : 'shadow-menu',
          'relative flex w-full flex-col justify-between gap-1 rounded-[12px] border border-border bg-input-background px-2 py-1 focus:border-primary',
          noBorder ? 'ring-0' : 'ring-[0.5px] ring-input'
        )}
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
            'writer-input h-full min-h-[32px] w-full select-text resize-none !border-none !px-1.5 !py-1 !text-sm caret-primary !shadow-none !outline-none !ring-0'
          }
        />

        <div className={'flex items-center justify-between gap-4'}>
          <div className='flex items-center gap-1'>
            {!noSwitchMode ? (
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    onMouseDown={(e) => {
                      e.preventDefault();
                    }}
                    variant={'ghost'}
                    size={'icon'}
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
            ) : (
              <div />
            )}

            <ModelSelector className={'h-7'} disabled={isFetching || isApplying} />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  variant={'ghost'}
                  className={'h-7 text-xs text-text-secondary'}
                  onClick={openModal}
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

          <div className={'flex items-center gap-1'}>
            <ViewTree />
            {!hasAIAnswer() && <WritingMore input={message} />}

            <Button
              onClick={handleSubmit}
              size={'icon'}
              variant={'link'}
              className={'text-fill-theme-thick p-0'}
              disabled={!message.trim() || isFetching}
              onMouseDown={(e) => {
                e.preventDefault();
              }}
            >
              {isFetching ? (
                <LoadingDots />
              ) : (
                <SendIcon className='h-7 w-7' />
              )}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
