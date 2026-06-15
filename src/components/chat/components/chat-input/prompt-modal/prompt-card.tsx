import { useState } from 'react';
import { useTranslation } from 'react-i18next';

import { AiPrompt } from '@/components/chat/types/prompt';
import { cn } from '@/lib/utils';

export function PromptCard({
  prompt,
  isSelected,
  onPreview,
  onUsePrompt,
}: {
  prompt: AiPrompt;
  isSelected: boolean;
  onPreview: () => void;
  onUsePrompt: () => void;
}) {
  const { t } = useTranslation();

  const [isHovered, setIsHovered] = useState(false);
  const [isUsePromptHovered, setIsUsePromptHovered] = useState(false);

  return (
    <div
      onMouseEnter={() => {
        setIsHovered(true);
        onPreview();
      }}
      onMouseLeave={() => {
        setIsHovered(false);
      }}
      className={cn(
        'relative rounded-[8px] border-[1.5px]',
        isSelected ? 'border-border-theme-thick' : 'border-border-primary',
      )}
    >
      <div
        className='flex flex-col p-2 cursor-pointer'
        onMouseDown={(e) => e.preventDefault()}
        onClick={onPreview}
      >
        <span className='truncate text-sm text-text-primary'>
          {prompt.name}
        </span>
        <span className='text-xs text-text-secondary line-clamp-2'>
          {prompt.content}
        </span>
      </div>
      {isHovered && (
        <div
          className={cn(
            'absolute right-1.5 top-1.5 shadow-md rounded-[8px] border border-border-primary px-2 py-1.5 cursor-pointer text-sm text-text-primary',
            isUsePromptHovered
              ? 'bg-surface-primary-hover'
              : 'bg-surface-primary',
          )}
          onMouseEnter={() => setIsUsePromptHovered(true)}
          onMouseLeave={() => setIsUsePromptHovered(false)}
          onClick={onUsePrompt}
        >
          {t('chat.customPrompt.usePrompt')}
        </div>
      )}
    </div>
  );
}
