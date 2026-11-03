import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as SettingsIcon } from '@/assets/icons/settings.svg';
import { Textarea } from '@/components/chat/components/ui/textarea';
import { useMessagesHandlerContext } from '@/components/chat/provider/messages-handler-provider';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
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
              data-active={active || undefined}
              data-testid='chat-input-settings'
              className={cn('h-7', active && 'bg-fill-content-hover')}
            >
              <SettingsIcon className={cn('h-5 w-5', active ? 'text-primary' : 'text-icon-secondary')} />
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{t('chat.chatSettings.title')}</TooltipContent>
      </Tooltip>
      <PopoverContent
        align={'start'}
        onOpenAutoFocus={(e) => e.preventDefault()}
        className={'flex w-[360px] flex-col gap-2 p-3'}
        data-testid='chat-settings-popover'
      >
        <div className={'text-sm font-medium text-text-primary'}>{t('chat.chatSettings.instructionsLabel')}</div>
        <Textarea
          rows={5}
          value={draft}
          maxLength={CHAT_INSTRUCTIONS_MAX_CHARS}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={t('chat.chatSettings.instructionsPlaceholder')}
          className={'min-h-[120px] resize-none !text-sm'}
          data-testid='chat-settings-instructions'
        />
        <div className={'flex items-center justify-between gap-2'}>
          <span className={'text-xs text-text-tertiary'}>{t('chat.chatSettings.hint')}</span>
          <Button size={'sm'} onClick={() => handleOpenChange(false)} data-testid='chat-settings-done'>
            {t('chat.chatSettings.done')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

export default ChatSettingsButton;
