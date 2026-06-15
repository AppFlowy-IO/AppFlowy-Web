import { ChevronDown } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CloseCircle } from '@/assets/icons/close_circle.svg';
import { usePromptModal } from '@/components/chat/provider/prompt-modal-provider';
import { useViewLoader } from '@/components/chat/provider/view-loader-provider';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { cn } from '@/lib/utils';


import { InvalidDatabaseDialog } from './invalid-database-dialog';
import { PromptDatabaseViews } from './prompt-database-views';


export function PromptDatabaseModal({
  isOpen,
  closeModal,
}: {
  isOpen: boolean;
  closeModal: () => void;
}) {
  const { getView } = useViewLoader();

  const { t } = useTranslation();

  const {
    databaseConfig,
    fields,
    saveDatabaseConfig,
    testDatabasePromptConfig,
  } = usePromptModal();

  const [currentDatabaseConfig, setCurrentDatabaseConfig] =
    useState(databaseConfig);
  const [currentFields, setCurrentFields] = useState(fields || []);
  const [isInvalidModalOpen, setIsInvalidModalOpen] = useState(false);

  useEffect(() => {
    setCurrentDatabaseConfig(databaseConfig);
    setCurrentFields(fields || []);
  }, [databaseConfig, fields]);

  const [viewName, setViewName] = useState<string | null>(null);

  useEffect(() => {
    void (async () => {
      if (!currentDatabaseConfig) return;
      if (!currentDatabaseConfig.databaseViewId) return;

      const view = await getView(currentDatabaseConfig.databaseViewId);

      setViewName(view?.name ?? null);
    })();
  }, [currentDatabaseConfig, getView]);

  const handleChangeViewId = useCallback(
    async (viewId: string) => {
      if (!viewId) return;

      if (testDatabasePromptConfig) {
        try {
          const { config: newConfig, fields: newFields } =
            await testDatabasePromptConfig(viewId);

          setCurrentDatabaseConfig(newConfig);
          setCurrentFields(newFields);
        } catch (e) {
          console.error('Error testing database prompt config:', e);
          setIsInvalidModalOpen(true);
          return;
        }
      }
    },
    [testDatabasePromptConfig],
  );

  const handleChangeContentId = useCallback(
    (contentFieldId: string) => {
      if (!currentDatabaseConfig) return;
      const newConfig = {
        ...currentDatabaseConfig,
        contentFieldId,
      };

      setCurrentDatabaseConfig(newConfig);
    },
    [currentDatabaseConfig],
  );

  const handleChangeExampleId = useCallback(
    (exampleFieldId: string | null) => {
      if (!currentDatabaseConfig) return;
      const newConfig = {
        ...currentDatabaseConfig,
        exampleFieldId: exampleFieldId,
      };

      setCurrentDatabaseConfig(newConfig);
    },
    [currentDatabaseConfig],
  );

  const handleChangeCategoryId = useCallback(
    (categoryFieldId: string | null) => {
      if (!currentDatabaseConfig) return;
      const newConfig = {
        ...currentDatabaseConfig,
        categoryFieldId: categoryFieldId,
      };

      setCurrentDatabaseConfig(newConfig);
    },
    [currentDatabaseConfig],
  );

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open && closeModal) {
          setCurrentDatabaseConfig(databaseConfig);
          setCurrentFields(fields || []);
          closeModal();
        }
      }}
    >
      <DialogContent
        className='h-[400px] w-[450px] flex flex-col gap-3 min-h-0 sm:max-w-[calc(100%-2rem)]'
        onEscapeKeyDown={(_e) => closeModal()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogTitle className='text-md text-text-primary font-bold'>
          {t('chat.customPrompt.configureDatabase')}
        </DialogTitle>
        <DialogDescription className='sr-only'>
          Configure database settings for custom prompts
        </DialogDescription>
        <div className='flex-1 flex flex-col min-h-0 w-full gap-4 px-2 py-4'>
          <div className='flex items-center'>
            <span className='flex-1 text-sm text-text-secondary'>
              {t('chat.customPrompt.selectDatabase')}
            </span>
            <PromptDatabaseViews onSelectView={handleChangeViewId}>
              <div className='flex-1 flex justify-center'>
                <Button variant={'outline'}>
                  {viewName === null
                    ? t('chat.customPrompt.selectDatabase')
                    : viewName === ''
                      ? t('chat.view.placeholder')
                      : viewName}
                </Button>
              </div>
            </PromptDatabaseViews>
          </div>
          {currentDatabaseConfig && (
            <div className='flex flex-col gap-2'>
              <FieldSelector
                title={t('chat.customPrompt.title')}
                selectedFieldId={currentDatabaseConfig?.titleFieldId || null}
                fields={currentFields.filter((f) => !f.isSelect)}
                isDisabled={true}
                onFieldChange={() => undefined}
              />
              <FieldSelector
                title={t('chat.customPrompt.content')}
                selectedFieldId={currentDatabaseConfig?.contentFieldId || null}
                fields={currentFields.filter((f) => !f.isSelect)}
                onFieldChange={handleChangeContentId}
              />
              <FieldSelector
                title={t('chat.customPrompt.example')}
                selectedFieldId={currentDatabaseConfig?.exampleFieldId || null}
                fields={currentFields.filter((f) => !f.isSelect)}
                onFieldChange={handleChangeExampleId}
                isOptional={true}
              />
              <FieldSelector
                title={t('chat.customPrompt.category')}
                selectedFieldId={currentDatabaseConfig?.categoryFieldId || null}
                fields={currentFields}
                onFieldChange={handleChangeCategoryId}
                isOptional={true}
              />
            </div>
          )}
        </div>
        <div className='flex gap-3 items-center justify-end'>
          <Button
            variant='outline'
            onClick={() => {
              setCurrentDatabaseConfig(databaseConfig);
              setCurrentFields(fields || []);
              closeModal();
            }}
          >
            {t('chat.customPrompt.button.cancel')}
          </Button>
          <Button
            disabled={!currentDatabaseConfig}
            onClick={() => {
              if (currentDatabaseConfig) {
                saveDatabaseConfig(currentDatabaseConfig);
              }

              closeModal();
            }}
          >
            {t('chat.customPrompt.button.done')}
          </Button>
        </div>
        <InvalidDatabaseDialog
          isOpen={isInvalidModalOpen}
          setIsOpen={setIsInvalidModalOpen}
        />
      </DialogContent>
    </Dialog>
  );
}

function FieldSelector({
  title,
  selectedFieldId,
  fields,
  onFieldChange,
  isDisabled,
  isOptional,
}: {
  title: string;
  selectedFieldId: string | null;
  fields: { id: string; name: string }[];
  onFieldChange: (fieldId: string) => void;
  isDisabled?: boolean;
  isOptional?: boolean;
}) {
  const { t } = useTranslation();

  const [isOpen, setIsOpen] = useState(false);
  const [isHovered, setIsHovered] = useState(false);

  const closeButtonRef = useRef<HTMLDivElement>(null);

  const value =
    fields.find((field) => field.id === selectedFieldId) ||
    (isOptional === true ? undefined : fields[0]);

  return (
    <div className='flex items-center'>
      <span className='flex-1 text-text-secondary text-sm'>{title}</span>
      <div className='relative flex-1 flex'>
        <DropdownMenu open={isOpen} onOpenChange={setIsOpen} modal={false}>
          <DropdownMenuTrigger
            asChild
            onPointerDown={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onClick={(e) => {
              if (
                closeButtonRef.current &&
                closeButtonRef.current.contains(e.target as Node)
              ) {
                onFieldChange('');
              }

              setIsOpen((prev) => !prev);
            }}
          >
            <div
              onMouseEnter={() => setIsHovered(true)}
              onMouseLeave={() => setIsHovered(false)}
              className={cn(
                'flex-1 flex items-center border cursor-default h-8 text-sm px-2 rounded-300 gap-1 font-normal',
                (!value || isDisabled) && 'text-text-tertiary',
                isDisabled && 'pointer-events-none bg-fill-content-hover',
                isOpen
                  ? 'border-border-theme-thick'
                  : isHovered
                    ? 'border-border-primary-hover'
                    : 'border-border-primary',
              )}
            >
              <span
                className='flex-1 truncate'
                onMouseDown={(e) => e.preventDefault()}
              >
                {value?.name || t('chat.customPrompt.optional')}
              </span>
              {isOptional && isOpen && value && (
                <div ref={closeButtonRef}>
                  <CloseCircle className='h-5 w-5 text-icon-tertiary' />
                </div>
              )}
              <ChevronDown size={16} className='text-icon-primary' />
            </div>
          </DropdownMenuTrigger>
          <DropdownMenuContent className='w-[--radix-dropdown-menu-trigger-width]'>
            <DropdownMenuRadioGroup
              value={value?.id}
              onValueChange={onFieldChange}
            >
              {fields.map((item) => (
                <DropdownMenuRadioItem
                  key={item.id}
                  value={item.id}
                  onMouseEnter={() => setIsHovered(true)}
                  onMouseLeave={() => setIsHovered(false)}
                >
                  {item.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </div>
  );
}
