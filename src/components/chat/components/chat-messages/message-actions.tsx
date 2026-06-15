import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ReactComponent as CopyIcon } from '@/assets/icons/copy.svg';
import { useChatContext } from '@/components/chat/chat/context';
import { convertToAppFlowyFragment } from '@/components/chat/lib/copy';
import { convertToPageData } from '@/components/chat/lib/utils';
import { useEditorContext } from '@/components/chat/provider/editor-provider';
import { useChatMessagesContext } from '@/components/chat/provider/messages-provider';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';

import AddMessageTo from '../chat-messages/add-message-to';
import Regenerations from '../chat-messages/regenerations';


export function MessageActions({ id, isHovered }: { id: number; isHovered: boolean }) {
  const { getMessage, messageIds } = useChatMessagesContext();

  const { selectionMode } = useChatContext();

  const { getEditor } = useEditorContext();

  const isLast = messageIds.indexOf(id) === 0;
  const [visible, setVisible] = useState(false);

  const ref = useRef<HTMLDivElement>(null);
  const { t } = useTranslation();

  useEffect(() => {
    if (isLast) {
      setVisible(true);
      return;
    }

    setVisible(isHovered);
  }, [isLast, isHovered]);

  const message = getMessage(id);

  const handleCopy = useCallback(async () => {
    const message = getMessage(id);

    if (!message) {
      return;
    }

    const editor = getEditor(id);

    if (!editor) return;
    try {
      const data = editor?.getData();

      const newJson = convertToPageData(data);

      const stringifies = JSON.stringify(newJson, null, 2);

      document.addEventListener(
        'copy',
        (e: ClipboardEvent) => {
          e.preventDefault();
          e.clipboardData?.setData('text/plain', message.content);
          e.clipboardData?.setData('application/json', stringifies);

          const { key, value } = convertToAppFlowyFragment(data);

          e.clipboardData?.setData(key, value);
        },
        { once: true }
      );

      document.execCommand('copy');

      toast.success(t('chat.success.copied'), { duration: 2000 });
      // eslint-disable-next-line
    } catch (e: any) {
      console.error(e);
      toast.error(t('chat.errors.copied'), { duration: 2000 });
    }
  }, [getEditor, getMessage, id, t]);

  if (selectionMode) return null;

  return (
    <div
      ref={ref}
      className={cn(
        'flex w-fit min-w-0 gap-2 max-sm:hidden',
        isLast
          ? `mt-2 min-h-[28px]`
          : `absolute -bottom-[34px] ml-0.5 min-h-[34px] ${
              isHovered ? 'rounded-[8px] border border-border-primary p-0.5 shadow-popover' : ''
            }`
      )}
    >
      {visible && message && (
        <>
          <Tooltip>
            <TooltipTrigger asChild>
              <Button
                onMouseDown={(e) => {
                  e.preventDefault();
                }}
                variant={'ghost'}
                size={'icon'}
                onClick={handleCopy}
              >
                <CopyIcon className='h-5 w-5 text-icon-secondary' />
              </Button>
            </TooltipTrigger>

            <TooltipContent align={'center'} side={'bottom'}>
              {t('chat.button.copyClipboard')}
            </TooltipContent>
          </Tooltip>
          <Regenerations id={id} sideOffset={isLast ? 4 : 8} />
          <AddMessageTo id={id} />
        </>
      )}
    </div>
  );
}
