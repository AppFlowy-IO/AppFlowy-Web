import { useCallback, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { useChatContext } from '@/components/chat/chat/context';
import { SearchInput } from '@/components/chat/components/ui/search-input';
import { useViewContentInserter } from '@/components/chat/hooks/use-view-content-inserter';
import { useEditorContext } from '@/components/chat/provider/editor-provider';
import { useViewLoader } from '@/components/chat/provider/view-loader-provider';
import { ChatMessage } from '@/components/chat/types';
import { Label } from '@/components/ui/label';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';

import { SpaceList } from '../add-messages-to-page-wrapper/space-list';

export function AddMessageToPageWrapper({
  onFinished,
  messages,
  children,
}: {
  messages: ChatMessage[];
  children?: React.ReactNode;
  onFinished?: () => void;
}) {
  const { openingViewId, chatId } = useChatContext();

  const { getView } = useViewLoader();
  const { getEditor } = useEditorContext();
  const { createViewWithContent, insertContentToView } = useViewContentInserter();

  const { t } = useTranslation();
  const [searchValue, setSearchValue] = useState('');

  const getData = useCallback(() => {
    return messages.reverse().flatMap((item) => {
      const editor = getEditor(item.message_id);

      return editor?.getData() || [];
    });
  }, [messages, getEditor]);

  const handleCreateViewWithContent = useCallback(
    async (parentViewId: string) => {
      const data = getData();
      const chat = await getView(chatId, false);

      const name = `Messages extracted from "${chat?.name || 'Untitled'}"`;

      try {
        await createViewWithContent(parentViewId, name, data);
        toast.success(
          t('chat.success.addMessageToPage', {
            name,
          })
        );
        onFinished?.();
        // eslint-disable-next-line
      } catch (e: any) {
        toast.error(e.message);
      }
    },
    [getData, getView, chatId, createViewWithContent, t, onFinished]
  );

  const handleInsertContentToView = useCallback(
    async (viewId: string) => {
      const data = getData();
      const chat = await getView(chatId, false);

      try {
        await insertContentToView(viewId, data);
        toast.success(
          t('chat.success.addMessageToPage', {
            name: chat?.name || t('chat.view.placeholder'),
          })
        );
        onFinished?.();
        // eslint-disable-next-line
      } catch (e: any) {
        toast.error(e.message);
      }
    },
    [getData, getView, chatId, insertContentToView, t, onFinished]
  );

  if (openingViewId) {
    return (
      <div
        onClick={async () => {
          await handleInsertContentToView(openingViewId);
        }}
      >
        {children}
      </div>
    );
  }

  return (
    <Popover modal>
      <PopoverTrigger asChild>
        <div className='h-7'>{children}</div>
      </PopoverTrigger>
      <PopoverContent onOpenAutoFocus={(e) => e.preventDefault()} onCloseAutoFocus={(e) => e.preventDefault()}>
        <div className={'flex h-fit max-h-[360px] min-h-[200px] w-[300px] flex-col'}>
          <Label className={'font-normal px-2 pt-2'}>{t('chat.addMessageToPage.placeholder')}</Label>
          <SearchInput value={searchValue} onChange={setSearchValue} className='m-2'/>
          <Separator />
          <div className={'appflowy-scrollbar flex-1 overflow-y-auto  overflow-x-hidden p-2'}>
            <SpaceList
              onCreateViewWithContent={handleCreateViewWithContent}
              onInsertContentToView={handleInsertContentToView}
              searchValue={searchValue}
            />
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
