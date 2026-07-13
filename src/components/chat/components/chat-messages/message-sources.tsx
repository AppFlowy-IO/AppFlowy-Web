import { ChevronDown, ExternalLink } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as DocumentIcon } from '@/assets/icons/page.svg';
import { useChatContext } from '@/components/chat/chat/context';
import { useViewLoader } from '@/components/chat/provider/view-loader-provider';
import { ChatMessageMetadata } from '@/components/chat/types';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export function getMessageSourceLabel(source: ChatMessageMetadata): string {
  return source.title?.trim() || source.name.trim() || source.id;
}

export function getSafeWebSourceUrl(source: ChatMessageMetadata): string | null {
  if (source.source !== 'web') return null;

  try {
    const url = new URL(source.id);

    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : null;
  } catch {
    return null;
  }
}

function isAppFlowySource(source: ChatMessageMetadata): boolean {
  // Empty and unknown source values are legacy AppFlowy document metadata.
  return source.source !== 'web' && source.source !== 'local_file';
}

function MessageSources({ sources }: { sources: ChatMessageMetadata[] }) {
  const { getView } = useViewLoader();
  const { onOpenView } = useChatContext();
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(true);
  const [viewNames, setViewNames] = useState<Record<string, string>>({});

  const appflowySourceIds = useMemo(
    () => Array.from(new Set(sources.filter(isAppFlowySource).map((source) => source.id))),
    [sources]
  );

  useEffect(() => {
    let cancelled = false;

    if (appflowySourceIds.length === 0) {
      setViewNames((current) => (Object.keys(current).length === 0 ? current : {}));
      return;
    }

    void Promise.all(
      appflowySourceIds.map(async (sourceId) => {
        const view = await getView(sourceId, false);

        return [sourceId, view?.name || ''] as const;
      })
    ).then((entries) => {
      if (!cancelled) {
        setViewNames(Object.fromEntries(entries));
      }
    });

    return () => {
      cancelled = true;
    };
  }, [appflowySourceIds, getView]);

  return (
    <div className={'flex flex-col pb-2 max-sm:hidden'}>
      <Button
        onClick={() => setExpanded((current) => !current)}
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
      {expanded ? (
        <div className={'flex flex-wrap items-start gap-2'}>
          {sources.map((source) => {
            const webUrl = getSafeWebSourceUrl(source);
            const label = viewNames[source.id] || getMessageSourceLabel(source) || t('chat.view.placeholder');
            const key = `${source.source}:${source.id}`;
            const content = (
              <>
                {source.source === 'web' ? <ExternalLink className={'h-4 w-4'} /> : <DocumentIcon />}
                <span className={'truncate text-foreground'}>{label}</span>
              </>
            );

            return (
              <Tooltip key={key}>
                <TooltipTrigger asChild>
                  {webUrl ? (
                    <Button asChild variant={'ghost'} className={'max-w-[160px] overflow-hidden'}>
                      <a href={webUrl} target={'_blank'} rel={'noopener noreferrer'}>
                        {content}
                      </a>
                    </Button>
                  ) : (
                    <Button
                      onClick={isAppFlowySource(source) ? () => onOpenView?.(source.id) : undefined}
                      disabled={!isAppFlowySource(source)}
                      variant={'ghost'}
                      className={'max-w-[160px] overflow-hidden'}
                    >
                      {content}
                    </Button>
                  )}
                </TooltipTrigger>
                <TooltipContent>{label}</TooltipContent>
              </Tooltip>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}

export default MessageSources;
