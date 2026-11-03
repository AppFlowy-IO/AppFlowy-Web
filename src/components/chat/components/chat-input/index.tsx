import { motion } from 'framer-motion';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ReactComponent as StopIcon } from '@/assets/icons/ai_stop_answering.svg';
import { ReactComponent as AttachmentIcon } from '@/assets/icons/attachment.svg';
import { ReactComponent as EarthIcon } from '@/assets/icons/earth.svg';
import { ReactComponent as SendIcon } from '@/assets/icons/filled_round_arrow_up.svg';
import { ReactComponent as AutoTextIcon } from '@/assets/icons/text.svg';
import { ReactComponent as ImageTextIcon } from '@/assets/icons/text_image.svg';
import { useChatContext } from '@/components/chat/chat/context';
import { FormatGroup } from '@/components/chat/components/ui/format-group';
import LoadingDots from '@/components/chat/components/ui/loading-dots';
import { Textarea } from '@/components/chat/components/ui/textarea';
import { useImageGenerationAvailable } from '@/components/chat/contexts/model-selector-context';
import { MESSAGE_VARIANTS } from '@/components/chat/lib/animations';
import { formatQuestionWithAttachments } from '@/components/chat/lib/attachments';
import { isImageContent } from '@/components/chat/lib/image-format';
import { useMessagesHandlerContext } from '@/components/chat/provider/messages-handler-provider';
import { useChatMessagesContext } from '@/components/chat/provider/messages-provider';
import { usePromptModal } from '@/components/chat/provider/prompt-modal-provider';
import { useResponseFormatContext } from '@/components/chat/provider/response-format-provider';
import { useSuggestionsContext } from '@/components/chat/provider/suggestions-provider';
import { AuthorType, ChatInputMode } from '@/components/chat/types';
import { AiPrompt } from '@/components/chat/types/prompt';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { ACCEPTED_ATTACHMENT_TYPES, AttachmentChips, useChatAttachments } from './attachments';
import { ChatSettingsButton } from './chat-settings';
import { ImageOptionsButton } from './image-options';
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
  const extrasRef = useRef<HTMLDivElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [sourcesOpen, setSourcesOpen] = useState(false);
  const [dragging, setDragging] = useState(false);

  const {
    submitQuestion,
    cancelAnswerStream,
    answerApplying,
    questionSending,
    chatSettings,
    updateChatSettings,
    ragScopeState,
    setEditingQuestionId,
  } = useMessagesHandlerContext();
  const { responseFormat, responseMode, setResponseFormat, setResponseMode, buildRequestFormat, resetImageIntent } =
    useResponseFormatContext();
  const { openModal, currentPromptId, updateCurrentPromptId, reloadDatabasePrompts } = usePromptModal();
  const { chatId, workspaceId, currentUser } = useChatContext();
  const { messageIds, getMessage } = useChatMessagesContext();
  const { getMessageSuggestions } = useSuggestionsContext();
  const imageGenerationAvailable = useImageGenerationAvailable();
  const { attachments, addFiles, removeAttachment, clearAttachments, readyAttachments, uploading } =
    useChatAttachments({ workspaceId, chatId });

  const webSearchEnabled = chatSettings?.web_search_enabled ?? false;

  const handleToggleWebSearch = useCallback(() => {
    void updateChatSettings({ web_search_enabled: !webSearchEnabled });
  }, [webSearchEnabled, updateChatSettings]);

  const disabled = questionSending || ragScopeState.status !== 'ready';

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
      const extrasHeight = extrasRef.current?.offsetHeight ?? 0;

      containerRef.current.style.height = `${
        newHeight + extrasHeight + (responseMode === ChatInputMode.FormatResponse ? 54 + 20 : 30 + 16)
      }px`; // 32px padding
    }
  }, [responseMode]);

  useEffect(() => {
    adjustHeight();
  }, [adjustHeight, attachments.length]);

  // The newest question of the current user, for ArrowUp editing. Other
  // members' questions are never editable from here.
  const latestOwnQuestionId = useCallback(() => {
    if (!currentUser?.uuid) return null;

    for (const id of messageIds) {
      const message = getMessage(id);

      if (message?.author.author_type === AuthorType.Human && message.author.author_uuid === currentUser.uuid) {
        return message.message_id;
      }
    }

    return null;
  }, [currentUser?.uuid, getMessage, messageIds]);

  const firstSuggestion = useCallback(() => {
    const latestAnswerId = messageIds[0];

    if (latestAnswerId === undefined) return null;

    return getMessageSuggestions(latestAnswerId - 1)?.items[0]?.content ?? null;
  }, [getMessageSuggestions, messageIds]);

  const handleInput = () => {
    adjustHeight();
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setMessage(e.target.value);
    adjustHeight();
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter confirms a composition (Chinese, Japanese, Korean input methods); it must not send.
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }

    if (e.key === 'Escape' && answerApplying) {
      e.preventDefault();
      cancelAnswerStream();
      return;
    }

    const empty = message.trim().length === 0;

    // "/" browses prompts, "@" picks sources, Tab takes the first suggestion and
    // ArrowUp edits the last question, all only from an empty input.
    if (empty && e.key === '/' && !e.shiftKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      reloadDatabasePrompts();
      openModal();
      return;
    }

    if (empty && e.key === '@' && !e.metaKey && !e.ctrlKey) {
      e.preventDefault();
      setSourcesOpen(true);
      return;
    }

    if (empty && e.key === 'Tab' && !e.shiftKey) {
      const suggestion = firstSuggestion();

      if (suggestion) {
        e.preventDefault();
        setMessage(suggestion);
      }

      return;
    }

    if (empty && e.key === 'ArrowUp' && !answerApplying && !questionSending) {
      const questionId = latestOwnQuestionId();

      if (questionId !== null) {
        e.preventDefault();
        setEditingQuestionId(questionId);
      }

      return;
    }

    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void handleSubmit();
    }
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const files = Array.from(e.clipboardData?.files ?? []);

    if (files.length === 0) return;
    e.preventDefault();
    addFiles(files);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    addFiles(Array.from(e.dataTransfer.files ?? []));
  };

  const handleSubmit = async () => {
    if (!message.trim() && readyAttachments.length === 0) {
      toast.error(`${t('chat.errors.emptyMessage')}`);
      return;
    }

    if (uploading) {
      toast.error(`${t('chat.attachments.waitForUpload')}`);
      return;
    }

    if (disabled || answerApplying) {
      toast.error(`${t('chat.errors.wait')}`);
      return;
    }

    const format = buildRequestFormat();
    const content = formatQuestionWithAttachments(message, readyAttachments);

    try {
      await submitQuestion(content, format);
      // The draft and its uploads are kept until the question is accepted, so a
      // rejected send loses nothing.
      setMessage('');
      clearAttachments();
      adjustHeight();
      // An image request applies to one message; the next question is text again.
      resetImageIntent();
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
        onDragOver={(e) => {
          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`relative flex flex-col justify-between gap-1 border ${
          focused || dragging ? 'border-primary ring-1 ring-ring' : 'ring-0'
        } w-full rounded-[12px] border-border px-2 py-1 focus:border-primary`}
        data-testid='chat-input-container'
      >
        <div ref={extrasRef}>
          <AttachmentChips attachments={attachments} onRemove={removeAttachment} />
        </div>
        {responseMode === ChatInputMode.FormatResponse && (
          <FormatGroup
            imageAvailable={imageGenerationAvailable}
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
          onPaste={handlePaste}
          ref={textareaRef}
          onFocus={() => {
            setFocused(true);
          }}
          placeholder={
            isImageContent(responseFormat.output_content) ? t('chat.image.inputPlaceholder') : t('chat.input.placeholder')
          }
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
                  <FormatIcon className='h-5 w-5 text-icon-secondary' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{formatTooltip}</TooltipContent>
            </Tooltip>

            <ModelSelector className={'h-7'} disabled={disabled || answerApplying} />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  variant={'ghost'}
                  size={'icon'}
                  disabled={disabled || answerApplying}
                  aria-pressed={webSearchEnabled}
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

            <ImageOptionsButton disabled={disabled || answerApplying} />

            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  variant={'ghost'}
                  size={'icon'}
                  disabled={disabled || answerApplying}
                  data-testid='chat-input-attach'
                  onClick={() => fileInputRef.current?.click()}
                >
                  <AttachmentIcon className='h-5 w-5 text-icon-secondary' />
                </Button>
              </TooltipTrigger>
              <TooltipContent>{t('chat.attachments.button')}</TooltipContent>
            </Tooltip>
            <input
              ref={fileInputRef}
              type='file'
              multiple
              accept={ACCEPTED_ATTACHMENT_TYPES}
              className='hidden'
              data-testid='chat-input-file'
              onChange={(e) => {
                addFiles(Array.from(e.target.files ?? []));
                e.target.value = '';
              }}
            />

            <ChatSettingsButton disabled={disabled} />

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
              <TooltipContent>{t('chat.customPrompt.browsePrompts')}</TooltipContent>
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
            <RelatedViews open={sourcesOpen} onOpenChange={setSourcesOpen} />
            {answerApplying ? (
              <Button
                onClick={cancelAnswerStream}
                size={'icon'}
                variant={'link'}
                className={'p-0 text-fill-theme-thick'}
              >
                <StopIcon className='h-7 w-7' />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                size={'icon'}
                variant={'link'}
                className={'p-0 text-fill-theme-thick'}
                disabled={(!message.trim() && readyAttachments.length === 0) || uploading || disabled}
                data-testid='chat-input-send'
              >
                {questionSending ? <LoadingDots /> : <SendIcon className='h-7 w-7' />}
              </Button>
            )}
          </div>
        </div>
      </div>
    </motion.div>
  );
}
