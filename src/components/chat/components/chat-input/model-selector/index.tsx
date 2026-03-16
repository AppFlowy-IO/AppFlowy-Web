import { motion } from 'framer-motion';
import { Check } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';

import { ReactComponent as AISparksIcon } from '@/assets/icons/ai.svg';
import { useModelSelectorContext } from '@/components/chat/contexts/model-selector-context';
import { MESSAGE_VARIANTS } from '@/components/chat/lib/animations';
import { ModelCache } from '@/components/chat/lib/model-cache';
import { AvailableModel, toModelDisplayInfo } from '@/components/chat/types/ai-model';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

interface ModelSelectorProps {
  className?: string;
  disabled?: boolean;
}

export function ModelSelector({ className, disabled }: ModelSelectorProps) {
  const [open, setOpen] = useState(false);
  const [selectedModel, setSelectedModel] = useState<string>('Auto'); // Start with Auto as default
  const [models, setModels] = useState<AvailableModel[]>([]);
  const [loading, setLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isInitialized, setIsInitialized] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);

  // Get unified context for model selection
  const context = useModelSelectorContext();

  if (!context) {
    throw new Error('ModelSelector must be used within a ModelSelectorContext.Provider');
  }

  const requestInstance = context.requestInstance;
  const chatId = context.chatId;
  const setSelectedModelName = context.setSelectedModelName;
  const contextSelectedModel = context.selectedModelName;

  // Track whether user has explicitly selected a model (prevents async init from overwriting)
  const userHasSelected = useRef(false);

  // Initialize: Load cached model or sync with context
  useEffect(() => {
    // Sync with context's selected model
    if (contextSelectedModel) {
      setSelectedModel(contextSelectedModel);
    }

    // If we have chat capabilities, load from server
    if (!chatId || isInitialized) {
      // For contexts without chatId, ensure Auto is used as default if nothing is set
      if (!contextSelectedModel && selectedModel !== 'Auto') {
        setSelectedModel('Auto');
        setSelectedModelName?.('Auto', false);
      }

      setIsInitialized(true);
      return;
    }

    // Step 1: Load from cache immediately for instant UI
    const cachedModel = ModelCache.get(chatId);

    if (cachedModel) {
      setSelectedModel(cachedModel);
      setSelectedModelName?.(cachedModel, false);
    }

    // Step 2: Fetch current model in background to get the truth
    let cancelled = false;
    const loadCurrentModel = async () => {
      if (!requestInstance.getCurrentModel) {
        // No model persistence available, use Auto as default
        if (!cachedModel) {
          setSelectedModel('Auto');
          setSelectedModelName?.('Auto', false);
        }

        return;
      }

      try {
        const currentModel = await requestInstance.getCurrentModel();

        // Skip if cancelled or user has already selected a model
        if (cancelled || userHasSelected.current) return;

        if (currentModel) {
          // Saved model found, use it
          setSelectedModel(currentModel);
          setSelectedModelName?.(currentModel, false);
          if (chatId) {
            ModelCache.set(chatId, currentModel);
          }
        } else if (!cachedModel) {
          // No saved model and no cache, use Auto as default
          setSelectedModel('Auto');
          setSelectedModelName?.('Auto', false);
        }
        // If no model saved but we have cache, keep using cache
      } catch (error) {
        if (cancelled || userHasSelected.current) return;
        console.warn('Failed to load current model', error);
        // Keep cached model if available, otherwise use Auto as default
        if (!cachedModel) {
          setSelectedModel('Auto');
          setSelectedModelName?.('Auto', false);
        }
      }
    };

    void loadCurrentModel();
    setIsInitialized(true);

    return () => {
      cancelled = true;
    };
  }, [chatId, requestInstance, isInitialized, setSelectedModelName, contextSelectedModel, selectedModel]);

  const loadModels = useCallback(async () => {
    setLoading(true);
    try {
      const modelList = await requestInstance.getModelList();

      setModels(modelList.models);

      // Don't override the selected model - it should come from chat settings
    } catch (error) {
      console.error('Failed to load models:', error);
      // Fallback to Auto only if API fails
      setModels([{ name: 'Auto', metadata: { is_default: true, desc: 'Auto select the best model' } }]);
    } finally {
      setLoading(false);
    }
  }, [requestInstance]);

  // Load models immediately on mount to display correct model names
  useEffect(() => {
    void loadModels();
  }, [loadModels]);

  // Load models when popover opens if not already loaded
  useEffect(() => {
    if (open && models.length === 0) {
      void loadModels();
    }
  }, [open, models.length, loadModels]);

  // Focus search input when popover opens
  useEffect(() => {
    if (open && searchInputRef.current) {
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    } else if (!open) {
      setSearchQuery('');
    }
  }, [open]);

  const handleSelect = useCallback(
    async (modelName: string) => {
      // Mark as user-initiated to prevent async init from overwriting
      userHasSelected.current = true;

      // Update UI immediately
      setSelectedModel(modelName);
      setOpen(false);

      // Update context if available (works for both chat and writer contexts)
      // Pass explicit=true to mark this as a user-initiated selection
      if (setSelectedModelName) {
        setSelectedModelName(modelName, true);
      }

      // Persist model selection using unified interface
      if (requestInstance.setCurrentModel) {
        // Update cache for chat context
        if (chatId) {
          ModelCache.set(chatId, modelName);
        }

        try {
          await requestInstance.setCurrentModel(modelName);
        } catch (error) {
          console.error('Failed to save current model:', error);
          // Cache is already updated, so user experience is not affected
        }
      }
    },
    [setSelectedModelName, chatId, requestInstance]
  );

  const filteredModels = models.filter((model) => {
    if (!searchQuery) return true;
    const query = searchQuery.toLowerCase();

    return (
      model.name.toLowerCase().includes(query) ||
      model.metadata?.desc?.toLowerCase().includes(query) ||
      model.provider?.toLowerCase().includes(query)
    );
  });

  // Use writer's model if in writer context, otherwise use local selected model
  const currentModel = contextSelectedModel || selectedModel;
  const selectedModelData = models.find((m) => m.name === currentModel);
  const displayText = selectedModelData?.name || currentModel || 'Auto';

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tooltip>
        <TooltipTrigger asChild>
          <PopoverTrigger asChild>
            <Button
              variant='ghost'
              className={cn('h-7 gap-1 px-2 text-xs font-normal text-text-secondary', className)}
              onMouseDown={(e) => e.preventDefault()}
              disabled={disabled}
              data-testid='model-selector-button'
            >
              <AISparksIcon className='h-5 w-5 text-icon-secondary' />
              <span className='max-w-[120px] truncate'>{displayText}</span>
            </Button>
          </PopoverTrigger>
        </TooltipTrigger>
        <TooltipContent>{'Select AI Model'}</TooltipContent>
      </Tooltip>
      <PopoverContent asChild className='w-[380px] rounded-lg p-0' align='start' side='top' sideOffset={8}>
        <motion.div
          variants={MESSAGE_VARIANTS.getSelectorVariants()}
          initial='hidden'
          animate={open ? 'visible' : 'exit'}
        >
          {/* Search Input */}
          <div className='border-b border-border-primary px-3 py-2'>
            <input
              ref={searchInputRef}
              type='text'
              placeholder='Search models...'
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className='w-full bg-transparent px-2 py-1 text-sm outline-none placeholder:text-text-placeholder'
              data-testid='model-search-input'
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setOpen(false);
                }
              }}
            />
          </div>

          {/* Models List */}
          <div className='appflowy-scrollbar max-h-[380px] overflow-y-auto py-1'>
            {loading ? (
              <div className='px-3 py-8 text-center text-sm text-text-secondary'>Loading models...</div>
            ) : filteredModels.length === 0 ? (
              <div className='px-3 py-8 text-center text-sm text-text-secondary'>
                {searchQuery ? 'No models found' : 'No models available'}
              </div>
            ) : (
              filteredModels.map((model) => {
                const displayInfo = toModelDisplayInfo(model);
                const isSelected = currentModel === model.name;

                return (
                  <button
                    key={displayInfo.id}
                    onClick={() => handleSelect(model.name)}
                    className={cn(
                      'w-full px-3 py-2.5 text-left transition-colors hover:bg-fill-content-hover',
                      'group flex items-start justify-between',
                      'focus:bg-fill-content-hover focus:outline-none',
                      isSelected && 'bg-fill-content-select'
                    )}
                    data-testid={`model-option-${model.name}`}
                  >
                    <div className='min-w-0 flex-1'>
                      <span className={cn('text-sm font-medium', isSelected && 'text-primary')}>{model.name}</span>
                      {model.metadata?.desc && (
                        <p className='mt-0.5 truncate pr-2 text-xs text-muted-foreground'>{model.metadata.desc}</p>
                      )}
                    </div>
                    {isSelected && <Check className='ml-2 mt-0.5 h-4 w-4 flex-shrink-0 text-primary' />}
                  </button>
                );
              })
            )}
          </div>
        </motion.div>
      </PopoverContent>
    </Popover>
  );
}

export default ModelSelector;
