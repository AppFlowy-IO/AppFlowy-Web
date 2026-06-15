import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { AiPrompt } from '@/components/chat/types/prompt';
import { Button } from '@/components/ui/button';


export function PromptPreview({
  prompt,
  onUsePrompt,
}: {
  prompt: AiPrompt;
  onUsePrompt: () => void;
}) {
  const { t } = useTranslation();

  const formattedContent = useMemo(() => {
    if (!prompt?.content) return null;

    const parts = prompt.content.split(/(\[.*?\])/g);

    return parts.map((part, index) => {
      if (part.startsWith('[') && part.endsWith(']')) {
        return (
          <span key={index} className='text-text-featured'>
            {part}
          </span>
        );
      }

      return <span key={index}>{part}</span>;
    });
  }, [prompt?.content]);

  return (
    <>
      <div className='flex items-center justify-between gap-1.5 sticky top-0 bg-background-primary pb-3'>
        <span className='text-2xl text-text-primary'>{prompt?.name}</span>
        <Button onClick={onUsePrompt} className='px-4 py-1.5'>
          {t('chat.customPrompt.usePrompt')}
        </Button>
      </div>
      <div className='flex flex-col gap-4 pt-3'>
        <div className='flex flex-col gap-1'>
          <span className='text-text-primary'>{t('chat.customPrompt.prompt')}</span>
          <span className='text-sm text-text-primary p-3 rounded-[8px] bg-surface-container-layer-01 whitespace-pre-wrap'>
            {formattedContent}
          </span>
        </div>
        {prompt?.example && (
          <div className='flex flex-col gap-1'>
            <span className='text-text-primary'>
              {t('chat.customPrompt.promptExample')}
            </span>
            <span className='text-sm text-text-primary p-3 rounded-[8px] bg-surface-container-layer-01 whitespace-pre-wrap'>
              {prompt.example}
            </span>
          </div>
        )}
      </div>
    </>
  );
}
