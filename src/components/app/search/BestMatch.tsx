import { debounce } from 'lodash-es';
import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { View } from '@/application/types';
import { getDatabaseIdFromExtra } from '@/application/view-utils';
import { SearchService } from '@/application/services/domains';
import type {
  SearchDocumentPageResponse,
  SearchDocumentResponseItem,
  SearchSummary,
} from '@/application/services/domains/search';
import { notify } from '@/components/_shared/notify';
import { findView } from '@/components/_shared/outline/utils';
import { useAIEnabled, useAppOutline, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { SearchAIOverview, SearchOverviewSource } from '@/components/app/search/SearchAIOverview';
import ViewList, { SearchViewListItem } from '@/components/app/search/ViewList';

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

function previewLines(text?: string | null, limit = 2): string | undefined {
  const lines = text
    ?.split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, limit);

  return lines?.length ? lines.join('\n') : undefined;
}

function searchResultKey(item: SearchDocumentResponseItem): string {
  return `${item.object_id}:${item.database_row_id || ''}`;
}

function mergeSearchResults(
  current: SearchDocumentResponseItem[],
  next: SearchDocumentResponseItem[]
): SearchDocumentResponseItem[] {
  const seen = new Set<string>();
  const merged: SearchDocumentResponseItem[] = [];

  for (const item of [...current, ...next]) {
    const key = searchResultKey(item);

    if (seen.has(key)) continue;

    seen.add(key);
    merged.push(item);
  }

  return merged;
}

function canLoadMoreSearchResults(page: SearchDocumentPageResponse, requestedOffset: number): boolean {
  return Boolean(page.has_more && typeof page.next_offset === 'number' && page.next_offset !== requestedOffset);
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
  const [items, setItems] = React.useState<SearchViewListItem[] | undefined>(undefined);
  const [searchResults, setSearchResults] = React.useState<SearchDocumentResponseItem[]>([]);
  const [summary, setSummary] = React.useState<SearchSummary | null>(null);
  const [hasMore, setHasMore] = React.useState(false);
  const [nextOffset, setNextOffset] = React.useState<number | null>(null);
  const { t } = useTranslation();
  const outline = useAppOutline();
  const [loading, setLoading] = React.useState<boolean>(false);
  const [summaryLoading, setSummaryLoading] = React.useState(false);
  const [loadingMore, setLoadingMore] = React.useState(false);
  const aiEnabled = useAIEnabled();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const searchSeqRef = useRef(0);

  const buildSearchItems = useCallback(
    (results: SearchDocumentResponseItem[]) => {
      if (!outline) return [];

      const seenTargets = new Set<string>();
      const items: SearchViewListItem[] = [];

      for (const item of results) {
        const view = resolveSearchResultView(outline, item);
        const rowId = item.database_row_id || undefined;

        if (!view || view.extra?.is_space) continue;

        const viewName = view.name.trim() || t('menuAppHeader.defaultNewPageName');
        const contentPreview = previewLines(item.content || item.preview);
        const targetId = `${view.view_id}:${rowId || ''}`;

        if (seenTargets.has(targetId)) continue;

        seenTargets.add(targetId);
        items.push({
          id: targetId,
          view,
          rowId,
          title: rowId
            ? `${t('document.grid.referencedGridPrefix', { defaultValue: 'View of' })} ${viewName}`
            : undefined,
          preview: contentPreview,
        });
      }

      return items;
    },
    [outline, t]
  );

  const handleSearch = useCallback(
    async (searchTerm: string) => {
      if (!outline) return;
      if (!currentWorkspaceId) return;
      const searchSeq = searchSeqRef.current + 1;

      searchSeqRef.current = searchSeq;
      setSummary(null);
      setSummaryLoading(false);
      if (!searchTerm) {
        setItems([]);
        setSearchResults([]);
        setHasMore(false);
        setNextOffset(null);
        setLoading(false);
        setLoadingMore(false);
        return;
      }

      setLoading(true);
      setLoadingMore(false);
      setItems(undefined);
      setSearchResults([]);
      setHasMore(false);
      setNextOffset(null);

      try {
        const page = await SearchService.searchWorkspaceDocumentPage(currentWorkspaceId, searchTerm, 0);

        if (searchSeqRef.current !== searchSeq) return;

        const res = mergeSearchResults([], page.items || []);
        const shouldGenerateSummary = aiEnabled && res.some((item) => item.content);

        setSearchResults(res);
        setItems(buildSearchItems(res));
        setHasMore(canLoadMoreSearchResults(page, 0));
        setNextOffset(page.next_offset ?? null);
        setSummaryLoading(shouldGenerateSummary);
        setLoading(false);

        if (shouldGenerateSummary) {
          try {
            const summaryResult = await SearchService.generateSearchSummary(currentWorkspaceId, searchTerm, res);

            if (searchSeqRef.current === searchSeq) {
              setSummary(summaryResult.summaries[0] || null);
            }
          } catch {
            if (searchSeqRef.current === searchSeq) {
              setSummary(null);
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
        setItems([]);
        setSummary(null);
        setSummaryLoading(false);
        setHasMore(false);
        setNextOffset(null);
      } finally {
        if (searchSeqRef.current === searchSeq) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [aiEnabled, buildSearchItems, currentWorkspaceId, outline]
  );

  const handleLoadMore = useCallback(async () => {
    if (!currentWorkspaceId || !searchValue || loading || loadingMore || !hasMore || nextOffset === null) return;

    const searchSeq = searchSeqRef.current;

    setLoadingMore(true);

    try {
      const page = await SearchService.searchWorkspaceDocumentPage(currentWorkspaceId, searchValue, nextOffset);

      if (searchSeqRef.current !== searchSeq) return;

      const mergedResults = mergeSearchResults(searchResults, page.items || []);

      setSearchResults(mergedResults);
      setItems(buildSearchItems(mergedResults));
      setHasMore(canLoadMoreSearchResults(page, nextOffset));
      setNextOffset(page.next_offset ?? null);
      // eslint-disable-next-line
    } catch (e: any) {
      if (searchSeqRef.current !== searchSeq) return;
      notify.error(e.message);
    } finally {
      if (searchSeqRef.current === searchSeq) {
        setLoadingMore(false);
      }
    }
  }, [buildSearchItems, currentWorkspaceId, hasMore, loading, loadingMore, nextOffset, searchResults, searchValue]);

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
    const resultByRowId = new Map(
      searchResults.flatMap((item) => (item.database_row_id ? [[item.database_row_id, item] as const] : []))
    );
    const seen = new Set<string>();

    return summary.sources.reduce<SearchOverviewSource[]>((sources, sourceId) => {
      const result = resultByObjectId.get(sourceId) || resultByRowId.get(sourceId);
      const view = findView(outline, sourceId) || (result ? resolveSearchResultView(outline, result) : undefined);
      const targetViewId = view?.view_id || result?.database_view_id || sourceId;
      const targetRowId = result?.database_row_id;
      const targetKey = `${targetViewId}:${targetRowId || ''}:${sourceId}`;

      if (seen.has(targetKey)) return sources;

      seen.add(targetKey);
      sources.push({
        id: sourceId,
        targetViewId,
        targetRowId,
        ragId: sourceId,
        view,
        name: view?.name?.trim() || t('menuAppHeader.defaultNewPageName'),
      });

      return sources;
    }, []);
  }, [outline, searchResults, summary, t]);

  return (
    <ViewList
      items={items}
      loading={loading}
      query={searchValue}
      title={t('commandPalette.bestMatches')}
      hasMore={hasMore}
      loadingMore={loadingMore}
      onClose={onClose}
      onLoadMore={handleLoadMore}
      header={
        aiEnabled ? (
          <SearchAIOverview
            askingAI={askingAI}
            loading={loading || summaryLoading}
            query={searchValue}
            sources={overviewSources}
            summary={summary}
            onClose={onClose}
            onAskAI={(sourceIds) => onAskAI(searchValue, sourceIds)}
          />
        ) : undefined
      }
    />
  );
}

export default BestMatch;
