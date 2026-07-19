import { debounce } from 'lodash-es';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SearchService, ViewService } from '@/application/services/domains';
import type {
  SearchDocumentPageResponse,
  SearchDocumentResponseItem,
  SearchSummary,
} from '@/application/services/domains/search';
import { View } from '@/application/types';
import { getDatabaseIdFromExtra } from '@/application/view-utils';
import { notify } from '@/components/_shared/notify';
import { findView } from '@/components/_shared/outline/utils';
import { isSpaceView } from '@/components/ai-chat/rag-scope';
import type { AIChatRagSource } from '@/components/ai-chat/rag-scope';
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

function getSearchResultViewIdCandidates(item: SearchDocumentResponseItem): string[] {
  return Array.from(new Set([item.object_id, item.database_view_id, item.database_id].filter(Boolean) as string[]));
}

async function loadSearchResultView(
  item: SearchDocumentResponseItem,
  currentWorkspaceId: string
): Promise<View | undefined> {
  const workspaceId = item.workspace_id || currentWorkspaceId;

  for (const viewId of getSearchResultViewIdCandidates(item)) {
    try {
      return await ViewService.get(workspaceId, viewId);
    } catch {
      // Search can return database/object ids that are not view ids. Try the next candidate.
    }
  }
}

async function loadSummarySourceViews(
  outline: View[],
  currentWorkspaceId: string,
  sourceIds: string[],
  searchResults: SearchDocumentResponseItem[]
): Promise<Map<string, View>> {
  const resultSourceIds = new Set(
    searchResults.flatMap((item) => [item.object_id, item.database_row_id].filter(Boolean) as string[])
  );
  const unresolvedSourceIds = Array.from(
    new Set(sourceIds.filter((sourceId) => !resultSourceIds.has(sourceId) && !findView(outline, sourceId)))
  );

  if (unresolvedSourceIds.length === 0) return new Map();

  try {
    const views = await ViewService.getMultiple(currentWorkspaceId, unresolvedSourceIds, 0);

    return new Map(views.filter((view) => !isSpaceView(view)).map((view) => [view.view_id, view]));
  } catch {
    return new Map();
  }
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
  onAskAI: (query: string, sources?: AIChatRagSource[]) => void;
}) {
  const [items, setItems] = useState<SearchViewListItem[] | undefined>(undefined);
  const [searchResults, setSearchResults] = useState<SearchDocumentResponseItem[]>([]);
  const [summary, setSummary] = useState<SearchSummary | null>(null);
  const [summarySourceViews, setSummarySourceViews] = useState<Map<string, View>>(() => new Map());
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const { t } = useTranslation();
  const outline = useAppOutline();
  const [loading, setLoading] = useState<boolean>(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const aiEnabled = useAIEnabled();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const searchSeqRef = useRef(0);

  const buildSearchItems = useCallback(
    async (results: SearchDocumentResponseItem[]) => {
      if (!outline || !currentWorkspaceId) return [];

      const seenTargets = new Set<string>();
      const items: SearchViewListItem[] = [];
      const resolvedViews = await Promise.all(
        results.map(
          async (item) => resolveSearchResultView(outline, item) || loadSearchResultView(item, currentWorkspaceId)
        )
      );

      for (const [index, item] of results.entries()) {
        const view = resolvedViews[index];
        const rowId = item.database_row_id || undefined;

        if (!view || isSpaceView(view)) continue;

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
    [currentWorkspaceId, outline, t]
  );

  const handleSearch = useCallback(
    async (searchTerm: string) => {
      if (!outline) return;
      if (!currentWorkspaceId) return;
      const searchSeq = searchSeqRef.current + 1;

      searchSeqRef.current = searchSeq;
      setSummary(null);
      setSummarySourceViews(new Map());
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

      const summaryRequest = aiEnabled
        ? SearchService.generateSearchSummary(currentWorkspaceId, searchTerm).catch(() => null)
        : null;

      try {
        const page = await SearchService.searchWorkspaceDocumentPage(currentWorkspaceId, searchTerm, 0);

        if (searchSeqRef.current !== searchSeq) return;

        const res = mergeSearchResults([], page.items || []);
        const shouldGenerateSummary = summaryRequest !== null;
        const searchItems = await buildSearchItems(res);

        if (searchSeqRef.current !== searchSeq) return;

        setSearchResults(res);
        setItems(searchItems);
        setHasMore(canLoadMoreSearchResults(page, 0));
        setNextOffset(page.next_offset ?? null);
        setSummaryLoading(shouldGenerateSummary);
        setLoading(false);

        if (shouldGenerateSummary) {
          const summaryResult = await summaryRequest;

          if (searchSeqRef.current !== searchSeq) return;

          const nextSummary = summaryResult?.summaries[0] || null;
          const sourceViews = nextSummary
            ? await loadSummarySourceViews(outline, currentWorkspaceId, nextSummary.sources, res)
            : new Map<string, View>();

          if (searchSeqRef.current !== searchSeq) return;

          setSummarySourceViews(sourceViews);
          setSummary(nextSummary);
          setSummaryLoading(false);
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
      const searchItems = await buildSearchItems(mergedResults);

      if (searchSeqRef.current !== searchSeq) return;

      setSearchResults(mergedResults);
      setItems(searchItems);
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
      const view =
        findView(outline, sourceId) ||
        summarySourceViews.get(sourceId) ||
        (result ? resolveSearchResultView(outline, result) : undefined);

      if (!result && !view) return sources;

      const targetRowId = result?.database_row_id;
      const targetViewId = view?.view_id || result?.database_view_id || (!targetRowId ? sourceId : undefined);

      if (!targetViewId) return sources;

      const targetKey = `${targetViewId}:${targetRowId || ''}:${sourceId}`;

      if (seen.has(targetKey)) return sources;

      seen.add(targetKey);
      sources.push({
        id: sourceId,
        targetViewId,
        targetRowId,
        ragId: sourceId,
        ownerViewId: view?.view_id || result?.database_view_id || (!targetRowId ? targetViewId : undefined),
        ownerDatabaseId: result?.database_id || undefined,
        view,
        name: view?.name?.trim() || t('menuAppHeader.defaultNewPageName'),
      });

      return sources;
    }, []);
  }, [outline, searchResults, summary, summarySourceViews, t]);

  const summarySourceCount = new Set(summary?.sources || []).size;
  const canAskFollowUp = summarySourceCount > 0 && overviewSources.length === summarySourceCount;

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
            canAskFollowUp={canAskFollowUp}
            onClose={onClose}
            onAskAI={(sources) => onAskAI(searchValue, sources)}
          />
        ) : undefined
      }
    />
  );
}

export default BestMatch;
