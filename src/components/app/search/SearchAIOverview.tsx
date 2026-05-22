import Popover from '@mui/material/Popover';
import React, { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { View } from '@/application/types';
import { ReactComponent as AISearchingIcon } from '@/assets/icons/ai_searching_icon.svg';
import { ReactComponent as ChatAIPageIcon } from '@/assets/icons/chat_ai_page.svg';
import { ReactComponent as HomeAIChatIcon } from '@/assets/icons/m_home_ai_chat_icon.svg';
import { ReactComponent as ToolbarLinkIcon } from '@/assets/icons/m_toolbar_link.svg';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { useToView } from '@/components/app/app.hooks';
import { cn } from '@/lib/utils';

export interface SearchOverviewSource {
  id: string;
  name: string;
  targetViewId: string;
  view?: View;
}

interface SearchAIOverviewProps {
  aiEnabled: boolean;
  askingAI: boolean;
  loading: boolean;
  query: string;
  sources: SearchOverviewSource[];
  summary?: {
    content: string;
    highlights?: string;
  } | null;
  onAskAI: (sourceIds?: string[]) => void;
  onClose: () => void;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function HighlightedSummary({
  content,
  highlights,
  query,
  sources,
  onClose,
}: {
  content: string;
  highlights?: string;
  query: string;
  sources: SearchOverviewSource[];
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const [expanded, setExpanded] = useState(false);
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const highlightText = (highlights || query).trim();
  const isLong = content.length > 520;
  const parts = useMemo(() => {
    if (!highlightText) return [content];

    return content.split(new RegExp(`(${escapeRegExp(highlightText)})`, 'ig'));
  }, [content, highlightText]);
  const showReference = sources.length > 0 && (!isLong || expanded);

  return (
    <>
      <div
        className='whitespace-pre-wrap break-words text-sm leading-[22px] text-text-primary'
        style={
          !expanded && isLong
            ? {
                display: '-webkit-box',
                WebkitBoxOrient: 'vertical',
                WebkitLineClamp: 5,
                overflow: 'hidden',
              }
            : undefined
        }
      >
        {parts.map((part, index) =>
          highlightText && part.toLowerCase() === highlightText.toLowerCase() ? (
            <mark key={`${part}-${index}`} className='bg-fill-theme-select px-0.5 text-text-primary'>
              {part}
            </mark>
          ) : (
            <React.Fragment key={`${part}-${index}`}>{part}</React.Fragment>
          )
        )}
        {showReference && (
          <button
            type='button'
            aria-label={t('commandPalette.aiOverviewSource', { defaultValue: 'Reference sources' })}
            className='ml-1 inline-flex h-[15px] w-[21px] items-center justify-center rounded-[6px] bg-secondary align-middle text-icon-primary hover:bg-secondary'
            onClick={(event) => setAnchorEl(event.currentTarget)}
          >
            <ToolbarLinkIcon className='h-2.5 w-2.5' />
          </button>
        )}
      </div>
      {isLong && !expanded && (
        <button
          type='button'
          className='mt-2 text-sm text-text-secondary hover:underline'
          onClick={() => setExpanded(true)}
        >
          {` ...${t('search.seeMore', { defaultValue: 'See more' })}`}
        </button>
      )}
      {sources.length > 0 && (
        <ReferenceSources
          anchorEl={anchorEl}
          onClosePopover={() => setAnchorEl(null)}
          onCloseSearch={onClose}
          sources={sources}
        />
      )}
    </>
  );
}

function ReferenceSources({
  anchorEl,
  onClosePopover,
  onCloseSearch,
  sources,
}: {
  anchorEl: HTMLElement | null;
  onClosePopover: () => void;
  onCloseSearch: () => void;
  sources: SearchOverviewSource[];
}) {
  const { t } = useTranslation();
  const navigateToView = useToView();
  const open = Boolean(anchorEl);

  return (
    <Popover
      open={open}
      anchorEl={anchorEl}
      onClose={onClosePopover}
      anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
      transformOrigin={{ vertical: 'top', horizontal: 'left' }}
      slotProps={{
        paper: {
          className: 'mt-1 max-h-[420px] w-[360px] overflow-hidden rounded-[8px] bg-surface-primary p-2 shadow-menu',
        },
      }}
    >
      <div className='px-2 py-1 text-sm font-medium text-text-secondary'>
        {t('commandPalette.aiOverviewSource', { defaultValue: 'Reference sources' })}
      </div>
      <div className='appflowy-scroller max-h-[360px] overflow-y-auto'>
        {sources.map((source) => (
          <button
            key={source.id}
            type='button'
            className='flex w-full items-start gap-2 rounded-[8px] px-2 py-3 text-left hover:bg-fill-content-hover'
            onClick={() => {
              onClosePopover();
              onCloseSearch();
              void navigateToView(source.targetViewId);
            }}
          >
            <span className='flex h-5 w-5 shrink-0 items-center justify-center'>
              {source.view ? (
                <PageIcon view={source.view} className='h-5 w-5' />
              ) : (
                <ToolbarLinkIcon className='h-4 w-4 text-icon-primary' />
              )}
            </span>
            <span className='min-w-0 flex-1 truncate text-sm text-text-primary'>{source.name}</span>
          </button>
        ))}
      </div>
    </Popover>
  );
}

function AskAIButton({ askingAI, query, onAskAI }: { askingAI: boolean; query: string; onAskAI: () => void }) {
  const { t } = useTranslation();

  return (
    <button
      type='button'
      disabled={askingAI}
      className='flex w-full items-center gap-2 rounded-[8px] p-3 text-left hover:bg-fill-content-hover disabled:cursor-default disabled:opacity-60'
      onClick={onAskAI}
    >
      <HomeAIChatIcon className='h-5 w-5 shrink-0' />
      <span className='min-w-0 flex-1 truncate text-sm leading-[22px] text-text-primary'>
        {query ? (
          <>
            {t('search.askAIFor', { defaultValue: 'Ask AI for' })} <span className='font-medium'>{`"${query}"`}</span>
          </>
        ) : (
          t('search.askAIAnything', { defaultValue: 'Ask AI anything' })
        )}
      </span>
    </button>
  );
}

export function SearchAIOverview({
  aiEnabled,
  askingAI,
  loading,
  query,
  sources,
  summary,
  onAskAI,
  onClose,
}: SearchAIOverviewProps) {
  const { t } = useTranslation();

  if (!aiEnabled) return null;

  if (loading) {
    return (
      <div className='px-2 py-1'>
        <div className='flex items-center gap-2 p-3 text-sm leading-[22px] text-text-secondary'>
          <HomeAIChatIcon className='h-5 w-5 shrink-0' />
          <span>{t('search.searching', { defaultValue: 'Searching...' })}</span>
        </div>
      </div>
    );
  }

  if (!summary?.content) {
    return (
      <div className='px-2 py-1'>
        <AskAIButton askingAI={askingAI} query={query} onAskAI={() => onAskAI()} />
      </div>
    );
  }

  return (
    <div className='px-2 pb-5 pt-3'>
      <div className='mb-3 flex items-center gap-2 text-sm font-medium leading-[22px] tracking-[0.2px] text-text-secondary'>
        <AISearchingIcon className='h-5 w-5 shrink-0' />
        <span>{t('commandPalette.aiOverview', { defaultValue: 'AI overview' })}</span>
      </div>
      <HighlightedSummary
        content={summary.content}
        highlights={summary.highlights}
        query={query}
        sources={sources}
        onClose={onClose}
      />
      <button
        type='button'
        disabled={askingAI}
        className={cn(
          'mt-3 inline-flex h-8 w-36 items-center justify-center gap-1.5 rounded-[16px] border border-border-primary px-3 py-1.5 text-sm font-medium leading-[22px] text-text-primary',
          'hover:bg-fill-content-hover disabled:cursor-default disabled:opacity-60'
        )}
        onClick={() => onAskAI(sources.map((source) => source.targetViewId))}
      >
        <ChatAIPageIcon className='h-5 w-5 shrink-0 text-icon-primary' />
        {t('commandPalette.aiAskFollowUp', { defaultValue: 'Ask follow-up' })}
      </button>
    </div>
  );
}
