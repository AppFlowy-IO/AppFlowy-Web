import { lazy, Suspense, useEffect, useId, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SearchService } from '@/application/services/domains';
import type { RecentOverviewTopic } from '@/application/services/domains/search';
import type { View } from '@/application/types';
import { ReactComponent as ArrowDown } from '@/assets/icons/alt_arrow_down_small.svg';
import { findView } from '@/components/_shared/outline/utils';
import { isSpaceView } from '@/components/ai-chat/rag-scope';
import { useAppOutline } from '@/components/app/app.hooks';
import type { SearchOverviewSource } from '@/components/app/search/SearchAIOverview';
import { loadSummarySourceViews } from '@/components/app/search/summary-source-views';
import { useAppLocale } from '@/i18n/useAppLocale';

const MarkdownSummary = lazy(() =>
  import('./SearchAIOverview').then(({ MarkdownSummary }) => ({ default: MarkdownSummary }))
);

function TopicSummary({
  topic,
  workspaceId,
  onClose,
}: {
  topic: RecentOverviewTopic;
  workspaceId: string;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const outline = useAppOutline();
  const [fetched, setFetched] = useState<Map<string, View>>();

  useEffect(() => {
    let active = true;

    void loadSummarySourceViews(outline || [], workspaceId, topic.summary.sources).then((views) => {
      if (active) setFetched(views);
    });
    return () => {
      active = false;
    };
  }, [outline, workspaceId, topic]);

  const sources = useMemo(() => {
    const resolved: SearchOverviewSource[] = [];

    for (const id of new Set(topic.summary.sources)) {
      const view = findView(outline || [], id) || fetched?.get(id);

      if (view && !isSpaceView(view)) {
        resolved.push({
          id,
          ragId: id,
          targetViewId: view.view_id,
          ownerViewId: view.view_id,
          view,
          name: view.name.trim() || t('menuAppHeader.defaultNewPageName'),
        });
      }
    }

    return resolved;
  }, [fetched, outline, topic, t]);

  return (
    <Suspense fallback={null}>
      <MarkdownSummary content={topic.summary.content} sources={sources} onClose={onClose} />
    </Suspense>
  );
}

export default function RecentOverviews({
  workspaceId,
  onClose,
  onAvailabilityChange,
}: {
  workspaceId: string;
  onClose: () => void;
  onAvailabilityChange?: (available: boolean) => void;
}) {
  const { t } = useTranslation();
  const locale = useAppLocale();
  const format = useMemo(
    () =>
      new Intl.DateTimeFormat(locale, {
        year: 'numeric',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
      }),
    [locale]
  );
  const [topics, setTopics] = useState<RecentOverviewTopic[]>([]);
  const [expanded, setExpanded] = useState<number | null>(0);
  const id = useId();

  useEffect(() => {
    const controller = new AbortController();

    void (async () => {
      // A replayed mount should not send a second history read.
      await Promise.resolve();
      if (controller.signal.aborted) return;
      try {
        const data = await SearchService.getRecentOverviews(workspaceId, controller.signal);

        if (!controller.signal.aborted && Array.isArray(data.topics)) {
          setTopics(
            data.topics
              .filter(
                (topic) =>
                  topic?.title?.trim() &&
                  topic.summary?.content?.trim() &&
                  Array.isArray(topic.summary.sources) &&
                  Number.isFinite(Date.parse(topic.generated_at))
              )
              .slice(0, 3)
          );
        }
      } catch {
        // Older servers and workspaces without readable topics still show Recent.
      }
    })();

    return () => controller.abort();
  }, [workspaceId]);

  useEffect(() => {
    if (!topics.length) return;
    onAvailabilityChange?.(true);
    return () => onAvailabilityChange?.(false);
  }, [onAvailabilityChange, topics.length]);

  if (topics.length === 0) return null;
  return (
    <section
      aria-labelledby={id}
      className='appflowy-scroller max-h-[240px] overflow-y-auto border-b border-line-default p-3'
    >
      <h2 id={id} className='mb-1 px-1 text-sm font-medium text-text-secondary'>
        {t('commandPalette.recentOverviews')}
      </h2>
      {topics.map((topic, index) => {
        const active = index === expanded;
        const panelId = `${id}-${index}`;
        const time = format.format(new Date(topic.generated_at));

        return (
          <div key={panelId}>
            <button
              type='button'
              className='flex w-full items-center gap-2 rounded px-1 py-2 text-left text-sm hover:bg-fill-content-hover'
              aria-expanded={active}
              aria-controls={panelId}
              onClick={() => setExpanded(active ? null : index)}
            >
              <span className='min-w-0 flex-1 truncate font-medium text-text-primary'>{topic.title}</span>
              <time dateTime={topic.generated_at} className='shrink-0 text-xs text-text-secondary'>
                {t('commandPalette.overviewGeneratedAt', { time })}
              </time>
              <ArrowDown aria-hidden className={`h-4 w-4 shrink-0 text-icon-secondary ${active ? 'rotate-180' : ''}`} />
            </button>
            <div id={panelId} hidden={!active} className='px-1 pb-2'>
              {active && <TopicSummary topic={topic} workspaceId={workspaceId} onClose={onClose} />}
            </div>
          </div>
        );
      })}
    </section>
  );
}
