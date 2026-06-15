import { ChevronDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as DocumentIcon } from '@/assets/icons/page.svg';
import { useChatContext } from '@/components/chat/chat/context';
import { useViewLoader } from '@/components/chat/provider/view-loader-provider';
import { ChatMessageMetadata, View } from '@/components/chat/types';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function MessageSources({ sources }: { sources: ChatMessageMetadata[] }) {
  const { getView } = useViewLoader();
  const { onOpenView } = useChatContext();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);

  const [views, setViews] = useState<View[]>([]);

  useEffect(() => {
    void (async () => {
      const views = [];

      for (const source of sources) {
        const view = await getView(source.id, false);

        if (!view) {
          continue;
        }

        views.push({
          ...view,
          name: view.name || t('chat.view.placeholder'),
        });
      }

      setViews(views);
    })();
  }, [getView, sources, t]);

  return (
    <div className={'flex flex-col pb-2 max-sm:hidden'}>
      <Button
        onClick={() => setExpanded(!expanded)}
        variant={'link'}
        className={'w-full justify-start text-foreground !no-underline opacity-60 hover:text-primary'}
      >
        <span>
          {t('chat.sources.label', {
            sourceCount: sources.length,
          })}
        </span>

        <ChevronDown className={`ml-1 h-4 w-4 ${expanded ? 'rotate-180 transform' : ''}`} />
      </Button>
      {expanded && (
        <div className={'flex flex-wrap items-start gap-2'}>
          {views.map((source, index) => (
            <Tooltip key={index}>
              <TooltipTrigger asChild>
                <Button
                  onClick={() => onOpenView?.(source.view_id)}
                  variant={'ghost'}
                  className={'max-w-[160px] overflow-hidden'}
                >
                  <DocumentIcon />
                  <span className={'truncate text-foreground'}>{source.name}</span>
                </Button>
              </TooltipTrigger>
              <TooltipContent>{source.name}</TooltipContent>
            </Tooltip>
          ))}
        </div>
      )}
    </div>
  );
}

export default MessageSources;
