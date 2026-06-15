import { motion } from 'framer-motion';
import { SearchIcon } from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CloseCircle } from '@/assets/icons/close_circle.svg';
import { SearchInput } from '@/components/chat/components/ui/search-input';
import { MESSAGE_VARIANTS } from '@/components/chat/lib/animations';
import { usePromptModal } from '@/components/chat/provider/prompt-modal-provider';
import { useViewLoader } from '@/components/chat/provider/view-loader-provider';
import { AiPrompt, AiPromptCategory } from '@/components/chat/types/prompt';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';

import { PromptCard } from './prompt-card';
import { PromptCategory } from './prompt-category';
import { PromptDatabaseModal } from './prompt-database';
import { PromptPreview } from './prompt-preview';

export const PromptModal = forwardRef<
  HTMLDivElement,
  {
    onUsePrompt: (prompt: AiPrompt) => void;
    returnFocus: () => void;
  }
>(({ onUsePrompt, returnFocus }, ref) => {
  const {
    isOpen,
    openModal,
    closeModal,
    prompts,
    reloadDatabasePrompts,
    databaseConfig,
  } = usePromptModal();

  const { getView } = useViewLoader();

  const { t } = useTranslation();

  const [isFeaturedSelected, setIsFeaturedSelected] = useState(true);
  const [isCustomSelected, setIsCustomSelected] = useState(false);
  const [selectedCatecory, setSelectedCategory] =
    useState<AiPromptCategory | null>(null);
  const [selectedPreviewPromptId, setSelectedPreviewPromptId] = useState<
    string | null
  >(null);
  const [filter, setFilter] = useState('');
  const [isPromptDatabaseModalOpen, setIsPromptDatabaseModalOpen] =
    useState(false);
  const [viewName, setViewName] = useState<string | null>(null);

  const isScrollingRef = useRef(false);
  const scrollTimeoutRef = useRef<number | null>(null);

  const visiblePrompts = useMemo(() => {
    return prompts.filter((prompt) => {
      const matchesCategory =
        (isFeaturedSelected && prompt.isFeatured) ||
        (isCustomSelected && prompt.isCustom) ||
        (!isFeaturedSelected &&
          !isCustomSelected &&
          selectedCatecory === null) ||
        (selectedCatecory && prompt.category.includes(selectedCatecory));

      if (!matchesCategory) return false;

      if (filter) {
        return (
          prompt.name.toLowerCase().includes(filter.toLowerCase()) ||
          prompt.content.toLowerCase().includes(filter.toLowerCase())
        );
      }

      return true;
    });
  }, [filter, isCustomSelected, isFeaturedSelected, prompts, selectedCatecory]);

  const selectedPrompt = useMemo(() => {
    const foundVisiblePrompt = visiblePrompts.find(
      (prompt) => prompt.id === selectedPreviewPromptId,
    );

    if (foundVisiblePrompt) {
      return foundVisiblePrompt;
    }

    if (visiblePrompts.length > 0) {
      setSelectedPreviewPromptId(visiblePrompts[0].id);
      return visiblePrompts[0];
    }
  }, [selectedPreviewPromptId, visiblePrompts]);

  useEffect(() => {
    void (async () => {
      if (!databaseConfig) return;
      if (!databaseConfig.databaseViewId) return;

      const view = await getView(databaseConfig.databaseViewId);

      setViewName(view?.name || null);
    })();
  }, [databaseConfig, getView]);

  const handleHoverPromptCard = useCallback(
    (id: string) => {
      if (isScrollingRef.current) return;

      setSelectedPreviewPromptId(id);
    },
    [setSelectedPreviewPromptId],
  );

  const handleScroll = useCallback(() => {
    if (scrollTimeoutRef.current) {
      clearTimeout(scrollTimeoutRef.current);
    }

    isScrollingRef.current = true;

    scrollTimeoutRef.current = window.setTimeout(() => {
      isScrollingRef.current = false;
    }, 100);
  }, []);

  const emptyDatabasePrompt = useMemo(() => {
    return (
      <div className='w-[83%] flex items-center justify-center'>
        <div className='flex flex-col items-center'>
          <span className='text-text-primary text-xl mb-1.5'>
            {t('chat.customPrompt.customPrompt')}
          </span>
          <span className='text-text-secondary text-sm mb-5'>
            {t('chat.customPrompt.databasePrompts')}
          </span>
          <Button onClick={() => setIsPromptDatabaseModalOpen(true)}>
            {t('chat.customPrompt.selectDatabase')}
          </Button>
        </div>
      </div>
    );
  }, [t]);

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) {
          setFilter('');
          if (visiblePrompts.length > 0) {
            setSelectedPreviewPromptId(visiblePrompts[0].id);
          }

          returnFocus();
          closeModal();
        } else {
          openModal();
          reloadDatabasePrompts();
        }
      }}
    >
      <DialogContent
        ref={ref}
        onEscapeKeyDown={(_e) => {
          setFilter('');
          closeModal();
        }}
        className='max-h-[800px] w-[1200px] flex flex-col gap-3 min-h-0 sm:max-w-[calc(100%-2rem)] p-0'
      >
        <motion.div
          variants={MESSAGE_VARIANTS.getSelectorVariants()}
          initial="hidden"
          animate={isOpen ? "visible" : "exit"}
          className='flex flex-col gap-3 min-h-0 p-5'
        >
        <DialogTitle className='text-md text-text-primary font-bold'>
          {t('chat.customPrompt.browsePrompts')}
        </DialogTitle>
        <DialogDescription className='sr-only'>
          Browse and select from available prompts to enhance your chat experience
        </DialogDescription>
        <div className='flex-1 flex min-h-0 w-full'>
          <div className='w-[17%] flex flex-col min-h-0'>
            <PromptCategory
              isFeaturedSelected={isFeaturedSelected}
              setIsFeaturedSelected={setIsFeaturedSelected}
              isCustomSelected={isCustomSelected}
              setIsCustomSelected={setIsCustomSelected}
              selectedCatecory={selectedCatecory}
              setSelectedCategory={setSelectedCategory}
            />
          </div>
          {isCustomSelected && !databaseConfig ? (
            emptyDatabasePrompt
          ) : (
            <>
              <div
                onScroll={handleScroll}
                className='w-[33%] flex flex-col gap-3 appflowy-scrollbar overflow-y-auto min-h-0 px-3 pb-3'
              >
                <div className='bg-background-primary sticky top-0 z-10 flex flex-col gap-3'>
                  {isCustomSelected && databaseConfig && (
                    <div className='flex items-center justify-between rounded-[8px] p-2 bg-surface-container-layer-01'>
                      <div>
                        <span className='text-text-primary text-sm font-medium'>
                          {`${t('chat.customPrompt.promptDatabase')}: `}
                        </span>
                        <span className='text-text-primary text-sm truncate'>
                          {viewName || t('chat.view.placeholder')}
                        </span>
                      </div>
                      <Button
                        variant='outline'
                        onClick={() => setIsPromptDatabaseModalOpen(true)}
                      >
                        {t('chat.customPrompt.button.change')}
                      </Button>
                    </div>
                  )}
                  <SearchInput
                    value={filter}
                    onChange={(value) => setFilter(value)}
                    className='h-10 py-[10px] px-2 rounded-[10px]'
                  >
                    {filter && (
                      <CloseCircle
                        className={'w-5 h-5 cursor-pointer text-icon-tertiary'}
                        onMouseDown={(e) => e.preventDefault()}
                        onClick={() => setFilter('')}
                      />
                    )}
                  </SearchInput>
                </div>
                {visiblePrompts.length > 0 ? (
                  visiblePrompts.map((prompt) => (
                    <PromptCard
                      key={prompt.id}
                      prompt={prompt}
                      isSelected={selectedPreviewPromptId === prompt.id}
                      onPreview={() => {
                        handleHoverPromptCard(prompt.id);
                      }}
                      onUsePrompt={() => {
                        onUsePrompt(prompt);
                        setFilter('');
                        returnFocus();
                        closeModal();
                      }}
                    />
                  ))
                ) : (
                  <div className='flex-1 flex flex-col items-center justify-center min-h-0'>
                    <SearchIcon size={24} className={'text-icon-secondary'} />
                    <span className='text-text-secondary text-sm'>
                      {t('chat.customPrompt.noResults')}
                    </span>
                  </div>
                )}
              </div>

              <div className='w-[50%] flex flex-col px-3 appflowy-scrollbar overflow-y-auto'>
                {selectedPrompt && (
                  <PromptPreview
                    prompt={selectedPrompt}
                    onUsePrompt={() => {
                      onUsePrompt(selectedPrompt);
                      setFilter('');
                      returnFocus();
                      closeModal();
                    }}
                  />
                )}
              </div>
            </>
          )}
        </div>
        <PromptDatabaseModal
          isOpen={isPromptDatabaseModalOpen}
          closeModal={() => {
            setIsPromptDatabaseModalOpen(false);
          }}
        />
        </motion.div>
      </DialogContent>
    </Dialog>
  );
});
