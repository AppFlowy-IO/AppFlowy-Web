import { motion } from 'framer-motion';
import debounce from 'lodash-es/debounce';
import { useEffect, useMemo, useState } from 'react';

import { ReactComponent as DocIcon } from '@/assets/icons/page.svg';
import { ReactComponent as ChevronDown } from '@/assets/icons/triangle_down.svg';
import { useViewLoader } from '@/components/chat';
import LoadingDots from '@/components/chat/components/ui/loading-dots';
import { SearchInput } from '@/components/chat/components/ui/search-input';
import { useChatSettingsLoader } from '@/components/chat/hooks/use-chat-settings-loader';
import { useCheckboxTree } from '@/components/chat/hooks/use-checkbox-tree';
import { MESSAGE_VARIANTS } from '@/components/chat/lib/animations';
import { searchViews } from '@/components/chat/lib/views';
import { View } from '@/components/chat/types';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';

import { Spaces } from './spaces';



export function RelatedViews() {

  const [searchValue, setSearchValue] = useState('');
  const [open, setOpen] = useState(false);

  const {
    chatSettings,
    fetchChatSettings,
    updateChatSettings,
  } = useChatSettingsLoader();

  const viewIds = useMemo(() => {
    return chatSettings?.rag_ids || [];
  }, [chatSettings]);

  useEffect(() => {
    void fetchChatSettings();
  }, [fetchChatSettings]);

  const {
    fetchViews,
    viewsLoading,
  } = useViewLoader();

  const [folder, setFolder] = useState<View | null>(null);

  useEffect(() => {
    void (async() => {
      const data = await fetchViews();

      if(!data) return;
      setFolder(data);
    })();
  }, [fetchViews]);

  const filteredSpaces = useMemo(() => {
    const spaces = folder?.children.filter(view => view.extra?.is_space);

    return searchViews(spaces || [], searchValue);
  }, [folder, searchValue]);

  const views = useMemo(() => {
    return folder?.children || [];
  }, [folder]);

  const {
    getSelected,
    getCheckStatus,
    toggleNode,
    getInitialExpand,
  } = useCheckboxTree(viewIds, views);

  const length = getSelected().length;

  const handleToggle = useMemo(() => {
    return debounce(async(ids: string[]) => {
      await updateChatSettings({
        rag_ids: ids,
      });
    }, 500);
  }, [updateChatSettings]);

  return (
    <Popover open={open} onOpenChange={setOpen} modal>
      <PopoverTrigger asChild={true}>
        <Button
          disabled={viewsLoading}
          size='sm'
          className='gap-0.5 px-1.5 text-sm text-text-secondary'
          variant={'ghost'}
          data-testid='chat-input-related-views'
        >
          <DocIcon className='h-5 w-5 text-icon-secondary' />
          {length}
          {viewsLoading ? <LoadingDots size={12} /> : <ChevronDown className='w-3 h-5' />}

        </Button>
      </PopoverTrigger>
      <PopoverContent asChild>
        <motion.div
          variants={MESSAGE_VARIANTS.getSelectorVariants()}
          initial="hidden"
          animate={open ? "visible" : "exit"}
          className={'h-fit min-h-[200px] max-h-[360px] w-[300px] flex flex-col'}
          data-testid='chat-related-views-popover'
        >
          <SearchInput
            className='m-2'
            value={searchValue}
            onChange={setSearchValue}
          />
          <Separator />
          <div className={'overflow-x-hidden overflow-y-auto flex-1 appflowy-scrollbar p-2'}>
            <Spaces
              getInitialExpand={getInitialExpand}
              spaces={filteredSpaces}
              viewsLoading={viewsLoading}
              getCheckStatus={getCheckStatus}
              onToggle={
                (view: View) => {
                  const ids = toggleNode(view);

                  void handleToggle(Array.from(ids));
                }
              }
            />
          </div>
        </motion.div>
      </PopoverContent>
    </Popover>
  );
}
