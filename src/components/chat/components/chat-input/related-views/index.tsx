import { motion } from 'framer-motion';
import debounce from 'lodash-es/debounce';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { ReactComponent as DocIcon } from '@/assets/icons/page.svg';
import { ReactComponent as ChevronDown } from '@/assets/icons/triangle_down.svg';
import { collectScopedRagIds, resolveScopedRagIds } from '@/components/ai-chat/rag-scope';
import LoadingDots from '@/components/chat/components/ui/loading-dots';
import { SearchInput } from '@/components/chat/components/ui/search-input';
import { useCheckboxTree } from '@/components/chat/hooks/use-checkbox-tree';
import { MESSAGE_VARIANTS } from '@/components/chat/lib/animations';
import { filterDocumentViews, searchViews } from '@/components/chat/lib/views';
import { useMessagesHandlerContext } from '@/components/chat/provider/messages-handler-provider';
import { View } from '@/components/chat/types';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';

import { Spaces } from './spaces';

export function RelatedViews() {
  const [searchValue, setSearchValue] = useState('');
  const [open, setOpen] = useState(false);
  const openGenerationRef = useRef(0);

  const {
    chatSettings,
    updateChatSettings,
    registerChatSettingsFlush,
    questionSending,
    ragScopeState,
    refreshRagScope,
  } = useMessagesHandlerContext();
  const parentView = ragScopeState.parentView;
  const viewsLoading = ragScopeState.status === 'loading';

  const scopedRoots = useMemo(() => {
    return parentView ? filterDocumentViews([parentView]) : [];
  }, [parentView]);

  const selectableViewIds = useMemo(() => collectScopedRagIds(scopedRoots), [scopedRoots]);
  const ragIds = chatSettings?.rag_ids;
  const fullWorkspace = chatSettings?.full_workspace;
  const viewIds = useMemo(
    () => resolveScopedRagIds(scopedRoots, { full_workspace: fullWorkspace, rag_ids: ragIds }),
    [fullWorkspace, ragIds, scopedRoots]
  );
  const preservedRagIds = useMemo(() => {
    const selectableIds = new Set(selectableViewIds);

    return Array.from(new Set(ragIds || [])).filter((id) => !selectableIds.has(id));
  }, [ragIds, selectableViewIds]);

  const filteredSpaces = useMemo(() => {
    return searchViews(scopedRoots, searchValue);
  }, [scopedRoots, searchValue]);

  const { getSelected, getCheckStatus, toggleNode, getInitialExpand } = useCheckboxTree(viewIds, scopedRoots);

  const length = getSelected().length;

  const handleToggle = useMemo(() => {
    const scopedIds = new Set(selectableViewIds);

    return debounce(async (ids: string[]) => {
      await updateChatSettings({
        rag_ids: [...ids.filter((id) => scopedIds.has(id)), ...preservedRagIds],
        full_workspace: false,
      });
    }, 500);
  }, [preservedRagIds, selectableViewIds, updateChatSettings]);

  const flushPendingToggle = useCallback(async () => {
    await handleToggle.flush();
  }, [handleToggle]);

  useEffect(() => {
    return () => {
      openGenerationRef.current += 1;
    };
  }, []);

  useEffect(() => {
    const unregister = registerChatSettingsFlush(flushPendingToggle);

    return () => {
      unregister();
      void flushPendingToggle();
      handleToggle.cancel();
    };
  }, [flushPendingToggle, handleToggle, registerChatSettingsFlush]);

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      const generation = openGenerationRef.current + 1;

      openGenerationRef.current = generation;
      setOpen(nextOpen);

      if (!nextOpen) {
        void flushPendingToggle();
        return;
      }

      if (ragScopeState.status !== 'loading') {
        void (async () => {
          await flushPendingToggle();
          if (openGenerationRef.current === generation) refreshRagScope();
        })();
      }
    },
    [flushPendingToggle, ragScopeState.status, refreshRagScope]
  );

  return (
    <Popover open={open} onOpenChange={handleOpenChange} modal>
      <PopoverTrigger asChild={true}>
        <Button
          disabled={viewsLoading || questionSending}
          size='sm'
          className='gap-0.5 px-1.5 text-sm text-text-secondary'
          variant={'ghost'}
          data-testid='chat-input-related-views'
        >
          <DocIcon className='h-5 w-5 text-icon-secondary' />
          {length}
          {viewsLoading ? <LoadingDots size={12} /> : <ChevronDown className='h-5 w-3' />}
        </Button>
      </PopoverTrigger>
      <PopoverContent asChild>
        <motion.div
          variants={MESSAGE_VARIANTS.getSelectorVariants()}
          initial='hidden'
          animate={open ? 'visible' : 'exit'}
          className={'flex h-fit max-h-[360px] min-h-[200px] w-[300px] flex-col'}
          data-testid='chat-related-views-popover'
        >
          <SearchInput className='m-2' value={searchValue} onChange={setSearchValue} />
          <Separator />
          <div className={'appflowy-scrollbar flex-1 overflow-y-auto overflow-x-hidden p-2'}>
            <Spaces
              getInitialExpand={getInitialExpand}
              spaces={filteredSpaces}
              viewsLoading={viewsLoading}
              getCheckStatus={getCheckStatus}
              onToggle={(view: View) => {
                if (questionSending) return;

                const ids = toggleNode(view);

                void handleToggle(Array.from(ids));
              }}
            />
          </div>
        </motion.div>
      </PopoverContent>
    </Popover>
  );
}
