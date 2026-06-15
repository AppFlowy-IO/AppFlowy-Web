import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as AskAIIcon } from '@/assets/icons/ai.svg';
import { ReactComponent as ImproveWritingIcon } from '@/assets/icons/ai_improve_writing.svg';
import { ReactComponent as ContinueWritingIcon } from '@/assets/icons/continue_writing.svg';
import { ReactComponent as ExplainIcon } from '@/assets/icons/help.svg';
import { ReactComponent as MakeLongerIcon } from '@/assets/icons/long_text.svg';
import { ReactComponent as MakeShorterIcon } from '@/assets/icons/short_text.svg';
import { ReactComponent as FixSpellingIcon } from '@/assets/icons/tick.svg';
import { AIAssistantType } from '@/components/chat/types';
import { useWriterContext } from '@/components/chat/writer/context';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';


export function AiWriterMenuContent({
  input,
  onClicked,
  isFilterOut,
}: {
  onClicked: (type: AIAssistantType) => void;
  isFilterOut?: (type: AIAssistantType) => boolean;
  input: string;
}) {
  const { t } = useTranslation();
  const { improveWriting, askAIAnything, fixSpelling, explain, makeLonger, makeShorter, continueWriting } =
    useWriterContext();

  const actions = useMemo(
    () =>
      [
        {
          icon: ContinueWritingIcon,
          label: t('chat.writer.continue'),
          key: AIAssistantType.ContinueWriting,
          onClick: () => continueWriting(input),
        },
        {
          icon: ImproveWritingIcon,
          label: t('chat.writer.improve'),
          key: AIAssistantType.ImproveWriting,
          onClick: () => improveWriting(input),
        },
        {
          key: AIAssistantType.AskAIAnything,
          icon: AskAIIcon,
          label: t('chat.writer.askAI'),
          onClick: () => askAIAnything(input),
        },
        {
          key: AIAssistantType.FixSpelling,
          icon: FixSpellingIcon,
          label: t('chat.writer.fixSpelling'),
          onClick: () => fixSpelling(input),
        },
        {
          key: AIAssistantType.Explain,
          icon: ExplainIcon,
          label: t('chat.writer.explain'),
          onClick: () => explain(input),
        },
      ].filter((item) => {
        return !isFilterOut || !isFilterOut(item.key);
      }),
    [askAIAnything, continueWriting, explain, fixSpelling, improveWriting, input, isFilterOut, t]
  );

  const otherActions = useMemo(
    () =>
      [
        {
          icon: MakeLongerIcon,
          label: t('chat.writer.makeLonger'),
          onClick: () => makeLonger(input),
          key: AIAssistantType.MakeLonger,
        },
        {
          icon: MakeShorterIcon,
          label: t('chat.writer.makeShorter'),
          onClick: () => makeShorter(input),
          key: AIAssistantType.MakeShorter,
        },
      ].filter((item) => {
        return !isFilterOut || !isFilterOut(item.key);
      }),
    [t, makeLonger, input, makeShorter, isFilterOut]
  );

  return (
    <div className='flex flex-col gap-1'>
      {actions.map((action, index) => (
        <Button
          key={index}
          onClick={() => {
            action.onClick();
            onClicked(action.key);
          }}
          className={'w-full justify-start !gap-[10px] !p-1.5 !font-normal !text-foreground'}
          variant={'ghost'}
          onMouseDown={(e) => e.preventDefault()}
        >
          <action.icon className={'!h-5 !w-5'} />
          {action.label}
        </Button>
      ))}
      {otherActions.length > 0 && <Separator />}

      {otherActions.map((action, index) => (
        <Button
          onClick={() => {
            void action.onClick();
            onClicked(action.key);
          }}
          key={index}
          className={'w-full justify-start !gap-[10px] !p-1.5 !font-normal !text-foreground'}
          variant={'ghost'}
          onMouseDown={(e) => e.preventDefault()}
        >
          {<action.icon className={'!h-5 !w-5'} />}
          {action.label}
        </Button>
      ))}
    </div>
  );
}
