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
  // Draft identity preserves edits even if the user retypes the submitted text.
  const [draft, setDraft] = useState({ text: '' });
  const message = draft.text;
  const setMessage = useCallback((text: string) => setDraft({ text }), []);

  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const sourcesTriggerRef = useRef<HTMLButtonElement>(null);
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
  const { messageIds, getMessage, getQuestionId } = useChatMessagesContext();
  const { getMessageSuggestions } = useSuggestionsContext();
  const imageGenerationAvailable = useImageGenerationAvailable();
  const { attachments, addFiles, removeAttachment, readyAttachments, uploading } =
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
  }, [chatId, setMessage]);

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

    // The composer itself sizes naturally, including wrapped toolbar rows.
  }, []);

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

    const questionId = getQuestionId(latestAnswerId);

    return questionId === undefined ? null : getMessageSuggestions(questionId)?.items[0]?.content ?? null;
  }, [getMessageSuggestions, getQuestionId, messageIds]);

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
      sourcesTriggerRef.current?.click();
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
    setDragging(false);
    const files = Array.from(e.dataTransfer.files ?? []);

    if (files.length === 0) return;

    e.preventDefault();
    addFiles(files);
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
    const submittedAttachmentIds = attachments
      .filter((item) => item.status === 'ready' && !!item.url)
      .map((item) => item.id);

    try {
      await submitQuestion(content, format);
      // Only clear the accepted draft; edits and uploads added during the send
      // belong to the next question. A rejected send leaves everything intact.
      setDraft((current) => (current === draft ? { text: '' } : current));
      submittedAttachmentIds.forEach(removeAttachment);
      // An image request applies to one message; the next question is text again.
      resetImageIntent();
    } catch (e) {
      console.error(e);
    } finally {
      updateCurrentPromptId(null);
    }
  };

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) return;

    if (typeof ResizeObserver === 'undefined') {
      window.addEventListener('resize', adjustHeight);
      return () => window.removeEventListener('resize', adjustHeight);
    }

    let previousWidth = textarea.clientWidth;
    const observer = new ResizeObserver(([entry]) => {
      if (!entry || entry.contentRect.width === previousWidth) return;

      previousWidth = entry.contentRect.width;
      adjustHeight();
    });

    observer.observe(textarea);

    return () => observer.disconnect();
  }, [adjustHeight]);

  const formatTooltip =
    responseMode === ChatInputMode.FormatResponse ? t('chat.input.button.auto') : t('chat.input.button.format');
  const FormatIcon = responseMode === ChatInputMode.FormatResponse ? AutoTextIcon : ImageTextIcon;

  useEffect(() => {
    adjustHeight();
  }, [adjustHeight, currentPromptId, message, responseMode]);

  const handleUsePrompt = useCallback(
    (prompt: AiPrompt) => {
      updateCurrentPromptId(prompt.id);
      setResponseMode(ChatInputMode.Auto);
      setMessage(prompt.content);
    },
    [setMessage, setResponseMode, updateCurrentPromptId]
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
        onDragOver={(e) => {
          if (!Array.from(e.dataTransfer.types ?? []).includes('Files')) return;

          e.preventDefault();
          if (!dragging) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        className={`relative flex flex-col justify-between gap-1 border ${
          focused || dragging ? 'border-border-theme-thick ring-1 ring-border-theme-thick' : 'border-border-primary ring-0'
        } w-full rounded-400 px-2 py-1`}
        data-testid='chat-input-container'
      >
        <AttachmentChips attachments={attachments} onRemove={removeAttachment} />
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
            'min-h-[32px] w-full shrink-0 resize-none !border-none !px-1.5 !py-1 !text-sm text-text-primary caret-fill-theme-thick !shadow-none !outline-none !ring-0 placeholder:text-text-tertiary'
          }
        />

        <div className={'flex flex-wrap items-end justify-between gap-2'}>
          <div className={'flex min-w-0 flex-1 basis-[320px] flex-wrap items-center gap-1'}>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  onMouseDown={(e) => {
                    e.preventDefault();
                  }}
                  variant={'ghost'}
                  size={'icon'}
                  data-testid='chat-input-format-toggle'
                  aria-label={formatTooltip}
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
                  aria-label={t('chat.webSearch.label')}
                  data-testid='chat-input-web-search-toggle'
                  onClick={handleToggleWebSearch}
                >
                  <EarthIcon className={`h-5 w-5 ${webSearchEnabled ? 'text-icon-info-thick' : 'text-icon-secondary'}`} />
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
                  aria-label={t('chat.attachments.button')}
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

          <div className={'ml-auto flex shrink-0 items-center gap-2'}>
            <RelatedViews triggerRef={sourcesTriggerRef} />
            {answerApplying ? (
              <Button
                onClick={cancelAnswerStream}
                size={'icon'}
                variant={'link'}
                aria-label={t('chat.input.button.stop')}
                className={'p-0 text-fill-theme-thick'}
              >
                <StopIcon className='h-7 w-7' />
              </Button>
            ) : (
              <Button
                onClick={handleSubmit}
                size={'icon'}
                variant={'link'}
                aria-label={t('chat.input.button.send')}
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
