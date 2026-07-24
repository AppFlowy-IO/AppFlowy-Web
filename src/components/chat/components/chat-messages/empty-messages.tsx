import { useCallback, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as Logo } from '@/assets/icons/logo.svg';
import { useMessagesHandlerContext } from '@/components/chat/provider/messages-handler-provider';
import { User } from '@/components/chat/types';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';

export function EmptyMessages({ currentUser }: { currentUser?: User }) {
  const { t } = useTranslation();
  const { chatSettings, submitQuestion, updateChatSettings, ragScopeState } = useMessagesHandlerContext();
  const initialPromptSubmittedRef = useRef(false);

  useEffect(() => {
    const metadata = chatSettings?.metadata;
    const initialPrompt = typeof metadata?.initial_prompt === 'string' ? metadata.initial_prompt.trim() : '';
    const consumed = metadata?.initial_prompt_consumed === true;

    if (ragScopeState.status !== 'ready' || !initialPrompt || consumed || initialPromptSubmittedRef.current) {
      return;
    }

    initialPromptSubmittedRef.current = true;
    void (async () => {
      try {
        await submitQuestion(initialPrompt);
        await updateChatSettings({
          metadata: {
            ...metadata,
            initial_prompt_consumed: true,
          },
        });
      } catch (e) {
        initialPromptSubmittedRef.current = false;
        console.error(e);
      }
    })();
  }, [chatSettings, ragScopeState.status, submitQuestion, updateChatSettings]);

  const handleClick = useCallback(
    async (content: string) => {
      try {
        await submitQuestion(content);
      } catch (e) {
        console.error(e);
      }
    },
    [submitQuestion]
  );

  return (
    <div className={'flex h-full w-full flex-col items-center justify-center gap-8'}>
      <div className={'flex w-full flex-col items-center justify-center gap-6'}>
        <Logo className={'h-10 w-10 text-text-secondary'} />
        <Label className={'text-foreground/70'}>
          {t('chat.placeholder', {
            name: currentUser?.name || t('chat.dear'),
          })}
        </Label>
      </div>
      <div className={'flex w-full flex-col items-center justify-center gap-4 text-foreground/60'}>
        <Button
          onClick={() => handleClick(t('chat.questions.one'))}
          variant={'outline'}
          className={'rounded-full px-4 py-2 shadow-sm'}
        >
          {t('chat.questions.one')}
        </Button>
        <Button
          onClick={() => handleClick(t('chat.questions.two'))}
          variant={'outline'}
          className={'rounded-full px-4 py-2 shadow-sm'}
        >
          {t('chat.questions.two')}
        </Button>
        <Button
          onClick={() => handleClick(t('chat.questions.three'))}
          variant={'outline'}
          className={'rounded-full px-4 py-2 shadow-sm'}
        >
          {t('chat.questions.three')}
        </Button>
        <Button
          onClick={() => handleClick(t('chat.questions.four'))}
          variant={'outline'}
          className={'rounded-full px-4 py-2 shadow-sm'}
        >
          {t('chat.questions.four')}
        </Button>
      </div>
    </div>
  );
}
