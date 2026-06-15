import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { AiPromptCategory } from '@/components/chat/types/prompt';
import { Button } from '@/components/ui/button';
import { Separator } from '@/components/ui/separator';
import { cn } from '@/lib/utils';


export function PromptCategory({
  isFeaturedSelected,
  isCustomSelected,
  selectedCatecory,
  setIsFeaturedSelected,
  setIsCustomSelected,
  setSelectedCategory,
}: {
  isFeaturedSelected: boolean;
  isCustomSelected: boolean;
  selectedCatecory: AiPromptCategory | null;
  setIsFeaturedSelected: (value: boolean) => void;
  setIsCustomSelected: (value: boolean) => void;
  setSelectedCategory: (category: AiPromptCategory | null) => void;
}) {
  const { t } = useTranslation();

  const isAllSelected = useMemo(() => {
    return !isCustomSelected && !isFeaturedSelected && !selectedCatecory;
  }, [isCustomSelected, isFeaturedSelected, selectedCatecory]);

  const categoryList = useMemo(() => {
    const categories = Object.values(AiPromptCategory);

    const withoutOthers = categories.filter(
      (category) => category !== 'others',
    );

    const sorted = withoutOthers
      .slice()
      .sort((a, b) =>
        t(`chat.customPrompt.${a}`).localeCompare(t(`chat.customPrompt.${b}`)),
      );

    return [...sorted, 'others'];
  }, [t]);

  return (
    <div className='flex flex-col pr-3 appflowy-scrollbar overflow-auto justify-between'>
      <div className='sticky top-0 z-10 bg-background-primary mb-2 flex flex-col'>
        <Button
          variant={'ghost'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setIsFeaturedSelected(true);
            setIsCustomSelected(false);
            setSelectedCategory(null);
          }}
          className={cn(
            'flex flex-shrink-0 justify-start',
            isFeaturedSelected ? '!bg-fill-theme-select' : '',
          )}
        >
          {t('chat.customPrompt.featured')}
        </Button>
        <Button
          variant={'ghost'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setIsCustomSelected(true);
            setIsFeaturedSelected(false);
            setSelectedCategory(null);
          }}
          className={cn(
            'flex justify-start',
            isCustomSelected ? '!bg-fill-theme-select' : '',
          )}
        >
          {t('chat.customPrompt.custom')}
        </Button>
        <Separator className='mt-2' />
      </div>
      <Button
        onMouseDown={(e) => e.preventDefault()}
        variant={'ghost'}
        onClick={() => {
          setSelectedCategory(null);
          setIsCustomSelected(false);
          setIsFeaturedSelected(false);
        }}
        className={cn(
          'flex flex-shrink-0 justify-start',
          isAllSelected && '!bg-fill-theme-select',
        )}
      >
        {t('chat.customPrompt.all')}
      </Button>
      {categoryList.map((category) => (
        <Button
          key={category ?? 'all'}
          variant={'ghost'}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            setSelectedCategory(category as AiPromptCategory | null);
            setIsFeaturedSelected(false);
            setIsCustomSelected(false);
          }}
          className={cn(
            'flex flex-shrink-0 justify-start',
            selectedCatecory === category ? '!bg-fill-theme-select' : '',
          )}
        >
          {t(`chat.customPrompt.${category}`, category)}
        </Button>
      ))}
    </div>
  );
}
