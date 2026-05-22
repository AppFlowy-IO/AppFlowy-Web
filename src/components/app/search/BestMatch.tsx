import { debounce } from 'lodash-es';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { View } from '@/application/types';
import { getDatabaseIdFromExtra } from '@/application/view-utils';
import { SearchService } from '@/application/services/domains';
import type { SearchDocumentResponseItem, SearchSummary } from '@/application/services/domains/search';
import { notify } from '@/components/_shared/notify';
import { findView } from '@/components/_shared/outline/utils';
import { useAIEnabled, useAppOutline, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { SearchAIOverview, SearchOverviewSource } from '@/components/app/search/SearchAIOverview';
import ViewList from '@/components/app/search/ViewList';

function findViewByDatabaseId(views: View[], databaseId?: string | null): View | undefined {
  if (!databaseId) return;

  for (const view of views) {
    if (getDatabaseIdFromExtra(view) === databaseId) {
      return view;
    }

    const child = findViewByDatabaseId(view.children || [], databaseId);

    if (child) return child;
  }
}

function resolveSearchResultView(outline: View[], item: SearchDocumentResponseItem): View | undefined {
  return (
    findView(outline, item.object_id) ||
    (item.database_view_id ? findView(outline, item.database_view_id) : undefined) ||
    findViewByDatabaseId(outline, item.database_id)
  );
}

function BestMatch({
  onClose,
  searchValue,
  askingAI,
  onAskAI,
}: {
  onClose: () => void;
  searchValue: string;
  askingAI: boolean;
  onAskAI: (query: string, sourceIds?: string[]) => void;
}) {
  const [views, setViews] = React.useState<View[] | undefined>(undefined);
  const [searchResults, setSearchResults] = React.useState<SearchDocumentResponseItem[]>([]);
  const [summary, setSummary] = React.useState<SearchSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = React.useState<boolean>(false);
  const { t } = useTranslation();
  const outline = useAppOutline();
  const [loading, setLoading] = React.useState<boolean>(false);
  const aiEnabled = useAIEnabled();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const searchSeqRef = useRef(0);

  const handleSearch = useCallback(
    async (searchTerm: string) => {
      if (!outline) return;
      if (!currentWorkspaceId) return;
      const searchSeq = searchSeqRef.current + 1;

      searchSeqRef.current = searchSeq;
      setSummary(null);
      setSummaryLoading(false);
      if (!searchTerm) {
        setViews([]);
        setSearchResults([]);
        return;
      }

      setLoading(true);

      try {
        const res = await SearchService.searchWorkspaceDocuments(currentWorkspaceId, searchTerm);

        if (searchSeqRef.current !== searchSeq) return;

        const seenViewIds = new Set<string>();
        const views: View[] = [];

        for (const item of res) {
          const view = resolveSearchResultView(outline, item);

          if (!view || view.extra?.is_space || seenViewIds.has(view.view_id)) continue;

          seenViewIds.add(view.view_id);
          views.push(view);
        }

        setSearchResults(res);
        setViews(views);

        if (aiEnabled && res.some((item) => item.content)) {
          setSummaryLoading(true);
          try {
            const summaryResult = await SearchService.generateSearchSummary(currentWorkspaceId, searchTerm, res);

            if (searchSeqRef.current === searchSeq) {
              setSummary(summaryResult.summaries[0] || null);
            }
          } finally {
            if (searchSeqRef.current === searchSeq) {
              setSummaryLoading(false);
            }
          }
        }
        // eslint-disable-next-line
      } catch (e: any) {
        if (searchSeqRef.current !== searchSeq) return;
        notify.error(e.message);
        setSearchResults([]);
        setViews([]);
        setSummary(null);
        setSummaryLoading(false);
      } finally {
        if (searchSeqRef.current === searchSeq) {
          setLoading(false);
        }
      }
    },
    [aiEnabled, currentWorkspaceId, outline]
  );

  const debounceSearch = useMemo(() => {
    return debounce(handleSearch, 300);
  }, [handleSearch]);

  useEffect(() => {
    void debounceSearch(searchValue);

    return () => {
      debounceSearch.cancel();
    };
  }, [searchValue, debounceSearch]);

  const overviewSources = useMemo<SearchOverviewSource[]>(() => {
    if (!summary || !outline) return [];

    const resultByObjectId = new Map(searchResults.map((item) => [item.object_id, item]));
    const seen = new Set<string>();

    return summary.sources.reduce<SearchOverviewSource[]>((sources, sourceId) => {
      const result = resultByObjectId.get(sourceId);
      const view = findView(outline, sourceId) || (result ? resolveSearchResultView(outline, result) : undefined);
      const targetViewId = view?.view_id || result?.database_view_id || sourceId;

      if (seen.has(targetViewId)) return sources;

      seen.add(targetViewId);
      sources.push({
        id: sourceId,
        targetViewId,
        view,
        name: view?.name?.trim() || t('menuAppHeader.defaultNewPageName'),
      });

      return sources;
    }, []);
  }, [outline, searchResults, summary, t]);

  return (
    <ViewList
      views={views}
      loading={loading}
      title={t('searchResults')}
      onClose={onClose}
      header={
        <SearchAIOverview
          aiEnabled={aiEnabled}
          askingAI={askingAI}
          loading={loading || summaryLoading}
          query={searchValue}
          sources={overviewSources}
          summary={summary}
          onClose={onClose}
          onAskAI={(sourceIds) => onAskAI(searchValue, sourceIds)}
        />
      }
    />
  );
}

export default BestMatch;
