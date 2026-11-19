import { useCallback, useEffect, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as SettingsIcon } from '@/assets/icons/settings.svg';
import { useMessagesHandlerContext } from '@/components/chat/provider/messages-handler-provider';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { TextareaAutosize } from '@/components/ui/textarea-autosize';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

export const CHAT_INSTRUCTIONS_MAX_CHARS = 4000;

/**
 * Per-chat instructions, stored in the chat settings metadata and injected by
 * the AI service into every answer of this chat.
 */
export function ChatSettingsButton({ disabled }: { disabled?: boolean }) {
  const { t } = useTranslation();
  const { chatSettings, updateChatSettings } = useMessagesHandlerContext();
  const [open, setOpen] = useState(false);
  const titleId = useId();
  const instructionsId = useId();
  const hintId = useId();
  const savedInstructions =
    typeof chatSettings?.metadata?.instructions === 'string' ? chatSettings.metadata.instructions : '';
  const [draft, setDraft] = useState(savedInstructions);

  useEffect(() => {
    if (!open) setDraft(savedInstructions);
  }, [open, savedInstructions]);

  const save = useCallback(async () => {
    const instructions = draft.trim().slice(0, CHAT_INSTRUCTIONS_MAX_CHARS);

    if (instructions === savedInstructions) return;

    await updateChatSettings({ metadata: { instructions } });
  }, [draft, savedInstructions, updateChatSettings]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      setOpen(nextOpen);
      if (!nextOpen) void save();
    },
    [save]
  );

  const active = savedInstructions.length > 0;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              onMouseDown={(e) => e.preventDefault()}
              variant={'ghost'}
              size={'icon'}
              disabled={disabled}
              aria-label={t('chat.chatSettings.title')}
              data-active={active || undefined}
              data-testid='chat-input-settings'
              className={cn(
                'h-7 focus-visible:ring-2 focus-visible:ring-border-theme-thick',
                active && 'bg-fill-theme-select'
              )}
            >
              <SettingsIcon className={cn('h-5 w-5', active ? 'text-icon-info-thick' : 'text-icon-secondary')} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('chat.chatSettings.title')}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align={'start'}
        aria-labelledby={titleId}
        className={
          'flex max-h-[var(--radix-popover-content-available-height)] w-[360px] max-w-[calc(100vw-16px)] flex-col gap-2 overflow-y-auto rounded-400 border border-border-primary bg-surface-layer-04 p-3 text-text-primary shadow-popover'
        }
        data-testid='chat-settings-popover'
      >
        <Label id={titleId} htmlFor={instructionsId} className={'text-sm leading-5 text-text-primary'}>
          {t('chat.chatSettings.instructionsLabel')}
        </Label>
        <TextareaAutosize
          id={instructionsId}
          aria-describedby={hintId}
          minRows={5}
          maxRows={10}
          disabled={disabled}
          value={draft}
          maxLength={CHAT_INSTRUCTIONS_MAX_CHARS}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('chat.chatSettings.instructionsPlaceholder')}
          className={'w-full rounded-[10px] py-1.5 text-text-primary disabled:bg-fill-content-hover'}
          data-testid='chat-settings-instructions'
        />
        <div className={'flex items-center justify-between gap-2'}>
          <span id={hintId} className={'text-xs leading-[18px] text-text-tertiary'}>
            {t('chat.chatSettings.hint')}
          </span>
          <Button
            size={'sm'}
            className={'focus-visible:ring-2 focus-visible:ring-border-theme-thick'}
            onClick={() => handleOpenChange(false)}
            data-testid='chat-settings-done'
          >
            {t('chat.chatSettings.done')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default ChatSettingsButton;
