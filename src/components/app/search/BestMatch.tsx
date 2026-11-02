import { debounce } from 'lodash-es';
import { lazy, Suspense, useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SearchService, ViewService } from '@/application/services/domains';
import type {
  SearchDocumentPageResponse,
  SearchDocumentResponseItem,
  SearchSummary,
  SearchSummaryResult,
} from '@/application/services/domains/search';
import { SearchStreamUnsupportedError } from '@/application/services/domains/search';
import { View } from '@/application/types';
import { getDatabaseIdFromExtra } from '@/application/view-utils';
import { notify } from '@/components/_shared/notify';
import { findView } from '@/components/_shared/outline/utils';
import { isSpaceView } from '@/components/ai-chat/rag-scope';
import type { AIChatRagSource } from '@/components/ai-chat/rag-scope';
import { useAIEnabled, useAppOutline, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { SearchPresentationObservation } from '@/components/app/search/search-presentation-observation';
import type { SearchOverviewSource } from '@/components/app/search/SearchAIOverview';
import ViewList, { SearchViewListItem } from '@/components/app/search/ViewList';
import { getErrorMessage } from '@/utils/errors';

const SearchAIOverview = lazy(() =>
  import('@/components/app/search/SearchAIOverview').then(({ SearchAIOverview }) => ({ default: SearchAIOverview }))
);

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

function createSearchStreamId(prefix: string): string {
  const id =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  return `${prefix}:${id}`;
}

function BestMatch({
  onClose,
  searchValue,
  queryStartedAt,
  askingAI,
  onAskAI,
}: {
  onClose: () => void;
  searchValue: string;
  queryStartedAt?: number;
  askingAI: boolean;
  onAskAI: (query: string, sources?: AIChatRagSource[]) => void;
}) {
  const [searchResults, setSearchResults] = useState<SearchDocumentResponseItem[]>([]);
  const [resultViews, setResultViews] = useState<Map<string, View>>(() => new Map());
  const [summary, setSummary] = useState<SearchSummary | null>(null);
  const [summarySourceViews, setSummarySourceViews] = useState<Map<string, View>>(() => new Map());
  const [hasMore, setHasMore] = useState(false);
  const [nextOffset, setNextOffset] = useState<number | null>(null);
  const { t } = useTranslation();
  const outline = useAppOutline();
  const outlineRef = useRef(outline);

  useLayoutEffect(() => {
    outlineRef.current = outline;
  }, [outline]);
  const [loading, setLoading] = useState<boolean>(false);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hydrating, setHydrating] = useState(false);
  const [finalSnapshot, setFinalSnapshot] = useState(false);
  const presentationRef = useRef<SearchPresentationObservation | null>(null);
  const presentationInput = useRef<{ workspaceId?: string; aiEnabled: boolean; query: string; startedAt?: number }>();
  const [resultIdentity, setResultIdentity] = useState('');
  const activeSearch = useRef<AbortController | null>(null);
  const aiEnabled = useAIEnabled();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const identity = `${currentWorkspaceId || ''}:${searchValue}`;
  const currentResults = resultIdentity === identity;
  const searchSeqRef = useRef(0);
  const [keywordSearchStreamId] = useState(() => createSearchStreamId('best-match-keyword'));

  // Metadata helps route results but is not a search input. Read the latest
  // outline when resolving a response without restarting requests on renames.
  const loadResultViews = useCallback(
    async (results: SearchDocumentResponseItem[]) => {
      const views = new Map<string, View>();

      if (!currentWorkspaceId) return views;
      const resolvedViews = await Promise.all(
        results.map(
          async (item) =>
            resolveSearchResultView(outlineRef.current || [], item) || loadSearchResultView(item, currentWorkspaceId)
        )
      );

      for (const [index, item] of results.entries()) {
        const view = resolvedViews[index];

        if (view) views.set(searchResultKey(item), view);
      }

      return views;
    },
    [currentWorkspaceId]
  );

  const items = useMemo<SearchViewListItem[]>(() => {
    if (!currentResults) return [];
    const seenTargets = new Set<string>();
    const items: SearchViewListItem[] = [];

    for (const item of searchResults) {
      const view = resolveSearchResultView(outline || [], item) || resultViews.get(searchResultKey(item));
      const rowId = item.database_row_id || undefined;

      if (!view || isSpaceView(view)) continue;
      const targetId = `${view.view_id}:${rowId || ''}`;

      if (seenTargets.has(targetId)) continue;
      seenTargets.add(targetId);
      const viewName = view.name.trim() || t('menuAppHeader.defaultNewPageName');

      items.push({
        id: targetId,
        view,
        rowId,
        title: rowId ? `${t('document.grid.referencedGridPrefix', { defaultValue: 'View of' })} ${viewName}` : undefined,
        preview: previewLines(item.content || item.preview),
      });
    }

    return items;
  }, [currentResults, outline, resultViews, searchResults, t]);

  const handleSearch = useCallback(
    async (searchTerm: string) => {
      if (!currentWorkspaceId) return;
      activeSearch.current?.abort();
      const controller = new AbortController();

      activeSearch.current = controller;
      const searchSeq = ++searchSeqRef.current;
      const isCurrent = () => searchSeqRef.current === searchSeq && !controller.signal.aborted;

      setResultIdentity(`${currentWorkspaceId}:${searchTerm}`);
      setSummary(null);
      setSummarySourceViews(new Map());
      setResultViews(new Map());
      setSummaryLoading(false);
      setLoadingMore(false);
      setHydrating(false);
      setFinalSnapshot(false);
      setSearchResults([]);
      setHasMore(false);
      setNextOffset(null);
      setLoading(Boolean(searchTerm.trim()));
      if (!searchTerm.trim()) return;

      let results: SearchDocumentResponseItem[] = [];
      let revision = 0;
      let keywordWindowFull = false;
      let usedLegacySearch = false;
      let legacySummaryPromise: Promise<SearchSummaryResult | null> | undefined;
      const routes = new Map<string, Promise<View | undefined>>();
      const presentation = presentationRef.current;
      // Publish rows before optional metadata reads finish. Each phase replaces the list; late
      // keyword hydration may add neither rows nor routing metadata to a newer final snapshot.
      const publish = (snapshot: SearchDocumentResponseItem[], isFinal: boolean) => {
        if (!isCurrent()) return;
        const snapshotRevision = ++revision;
        const routeKey = (item: SearchDocumentResponseItem) =>
          JSON.stringify([item.object_id, item.database_view_id, item.database_id]);
        const previousRoutes = new Map(results.map((item) => [searchResultKey(item), routeKey(item)]));

        results = mergeSearchResults([], snapshot);
        const retainedKeys = new Set(
          results.filter((item) => previousRoutes.get(searchResultKey(item)) === routeKey(item)).map(searchResultKey)
        );

        setSearchResults(results);
        setFinalSnapshot(isFinal);
        // Retain routing for unchanged rows so a final reorder cannot briefly remove the
        // selected row while its already-resolved metadata promise runs again.
        setResultViews((previous) => new Map([...previous].filter(([key]) => retainedKeys.has(key))));
        setHydrating(true);
        const reads = results.map(async (item) => {
          const key = routeKey(item);
          let request = routes.get(key);

          if (!request) {
            request = Promise.resolve(
              resolveSearchResultView(outlineRef.current || [], item) || loadSearchResultView(item, currentWorkspaceId)
            );
            routes.set(key, request);
          }

          const view = await request;

          if (view && isCurrent() && revision === snapshotRevision) {
            setResultViews((previous) => new Map(previous).set(searchResultKey(item), view));
          }
        });

        void Promise.allSettled(reads).then(() => {
          if (isCurrent() && revision === snapshotRevision) setHydrating(false);
        });
      };

      try {
        presentation?.issue();
        try {
          const completion = await SearchService.searchWorkspaceDocumentStream(currentWorkspaceId, searchTerm, {
            signal: controller.signal,
            requestStreamId: keywordSearchStreamId,
            mode: aiEnabled ? 'hybrid' : 'keyword',
            onSnapshot: (snapshot) => {
              if (snapshot.phase === 'keyword') keywordWindowFull = snapshot.items.length >= 10;
              publish(snapshot.items, snapshot.phase === 'final');
            },
          });

          if (!isCurrent()) return;
          if (completion.outcome === 'superseded') {
            presentation?.terminate('superseded');
            revision += 1;
            setHydrating(false);
            setSearchResults([]);
            setResultViews(new Map());
            return;
          }

          presentation?.received(completion.outcome);

          // The stream has no keyword cursor. Continue lazily from keyword offset zero so no
          // range is skipped when semantic hits displaced keyword hits in the final top results.
          setHasMore(keywordWindowFull || results.length >= 10);
          setNextOffset(0);
        } catch (error) {
          if (!isCurrent()) return;
          if (!(error instanceof SearchStreamUnsupportedError)) throw error;
          usedLegacySearch = true;
          presentation?.useLegacy();
          // Legacy automatic context is independent of the keyword page. Start both
          // together, and handle rejection now even if the page later fails or is cancelled.
          if (aiEnabled) {
            legacySummaryPromise = SearchService.generateSearchSummary(
              currentWorkspaceId,
              searchTerm,
              controller.signal
            ).catch(() => null);
          }

          const page = await SearchService.searchWorkspaceDocumentPage(
            currentWorkspaceId,
            searchTerm,
            0,
            keywordSearchStreamId,
            controller.signal
          );

          if (!isCurrent()) return;
          presentation?.received('complete');
          publish(page.items || [], true);
          setHasMore(canLoadMoreSearchResults(page, 0));
          setNextOffset(page.next_offset ?? null);
        }

        if (!isCurrent()) return;
        setLoading(false);

        if (aiEnabled && (usedLegacySearch || results.length > 0)) {
          setSummaryLoading(true);
          // Completed stream IDs let the summary endpoint reload its own content without
          // repeating vector retrieval. Older servers retain their existing automatic context.
          const summaryResult = usedLegacySearch
            ? await legacySummaryPromise
            : await SearchService.generateSearchSummaryForDocuments(
                currentWorkspaceId,
                searchTerm,
                results.map((item) => item.object_id),
                controller.signal
              ).catch(() => null);

          if (!isCurrent()) return;
          const nextSummary = summaryResult?.summaries[0] || null;
          const sourceViews = nextSummary
            ? await loadSummarySourceViews(outlineRef.current || [], currentWorkspaceId, nextSummary.sources, results)
            : new Map<string, View>();

          if (!isCurrent()) return;
          setSummarySourceViews(sourceViews);
          setSummary(nextSummary);
          setSummaryLoading(false);
        }
      } catch (error) {
        if (!isCurrent()) return;
        presentation?.terminate('error');
        revision += 1;
        setHydrating(false);
        notify.error(getErrorMessage(error));
        setSearchResults([]);
        setResultViews(new Map());
        setSummary(null);
        setSummaryLoading(false);
        setHasMore(false);
        setNextOffset(null);
      } finally {
        if (isCurrent()) {
          setLoading(false);
        }
      }
    },
    [aiEnabled, currentWorkspaceId, keywordSearchStreamId]
  );

  const handleLoadMore = useCallback(async () => {
    if (
      !currentResults ||
      !currentWorkspaceId ||
      !searchValue ||
      loading ||
      loadingMore ||
      !hasMore ||
      nextOffset === null
    )
      return;

    presentationRef.current?.finishInitialWindow();
    const searchSeq = searchSeqRef.current;

    setLoadingMore(true);

    try {
      const page = await SearchService.searchWorkspaceDocumentPage(
        currentWorkspaceId,
        searchValue,
        nextOffset,
        keywordSearchStreamId,
        activeSearch.current?.signal
      );

      if (searchSeqRef.current !== searchSeq) return;

      const mergedResults = mergeSearchResults(searchResults, page.items || []);

      setSearchResults(mergedResults);
      const views = await loadResultViews(page.items || []);

      if (searchSeqRef.current !== searchSeq) return;
      setResultViews((previous) => new Map([...previous, ...views]));
      setHasMore(canLoadMoreSearchResults(page, nextOffset));
      setNextOffset(page.next_offset ?? null);
    } catch (error) {
      if (searchSeqRef.current !== searchSeq || activeSearch.current?.signal.aborted) return;
      notify.error(getErrorMessage(error));
    } finally {
      if (searchSeqRef.current === searchSeq) {
        setLoadingMore(false);
      }
    }
  }, [
    loadResultViews,
    currentResults,
    currentWorkspaceId,
    hasMore,
    keywordSearchStreamId,
    loading,
    loadingMore,
    nextOffset,
    searchResults,
    searchValue,
  ]);

  const debounceSearch = useMemo(() => {
    return debounce(handleSearch, 300);
  }, [handleSearch]);

  useLayoutEffect(() => {
    const previous = presentationInput.current;
    const changedInput = !previous || previous.query !== searchValue || previous.startedAt !== queryStartedAt;
    const changedContext = previous && (previous.workspaceId !== currentWorkspaceId || previous.aiEnabled !== aiEnabled);
    // A workspace/mode switch starts new work even when the input itself did not change.
    const startedAt = changedContext && !changedInput ? performance.now() : queryStartedAt ?? performance.now();

    presentationInput.current = {
      workspaceId: currentWorkspaceId,
      aiEnabled,
      query: searchValue,
      startedAt: queryStartedAt,
    };
    const observation =
      currentWorkspaceId && searchValue.trim()
        ? new SearchPresentationObservation({
            startedAt,
            mode: aiEnabled ? 'hybrid' : 'keyword',
            report: (metrics) => {
              void SearchService.reportSearchPresentationMetrics(currentWorkspaceId, metrics);
            },
          })
        : null;

    presentationRef.current = observation;
    void debounceSearch(searchValue);

    return () => {
      debounceSearch.cancel();
      activeSearch.current?.abort();
      observation?.terminate('cancelled');
      // Ignore old responses immediately, including during the next debounce
      // interval and after the search dialog has unmounted.
      searchSeqRef.current += 1;
    };
  }, [aiEnabled, currentWorkspaceId, queryStartedAt, searchValue, debounceSearch]);

  useLayoutEffect(() => {
    presentationRef.current?.committedRows(
      currentResults && items.length > 0,
      currentResults && finalSnapshot && !hydrating && (items.length > 0 || !loading)
    );
  }, [currentResults, finalSnapshot, hydrating, items, loading]);

  const overviewSources = useMemo<SearchOverviewSource[]>(() => {
    if (!currentResults || !summary) return [];

    const resultByObjectId = new Map(searchResults.map((item) => [item.object_id, item]));
    const resultByRowId = new Map(
      searchResults.flatMap((item) => (item.database_row_id ? [[item.database_row_id, item] as const] : []))
    );
    const seen = new Set<string>();

    return summary.sources.reduce<SearchOverviewSource[]>((sources, sourceId) => {
      const result = resultByObjectId.get(sourceId) || resultByRowId.get(sourceId);
      const view =
        findView(outline || [], sourceId) ||
        summarySourceViews.get(sourceId) ||
        (result
          ? resolveSearchResultView(outline || [], result) || resultViews.get(searchResultKey(result))
          : undefined);

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
  }, [currentResults, outline, resultViews, searchResults, summary, summarySourceViews, t]);

  const visibleSummary = currentResults ? summary : null;
  const searchPending = currentResults
    ? loading || (hydrating && items.length === 0)
    : Boolean(currentWorkspaceId && searchValue.trim());
  const summarySourceCount = new Set(visibleSummary?.sources || []).size;
  const canAskFollowUp = summarySourceCount > 0 && overviewSources.length === summarySourceCount;

  return (
    <ViewList
      items={items}
      loading={searchPending}
      selectionKey={identity}
      query={searchValue}
      title={t('commandPalette.bestMatches')}
      hasMore={currentResults && !loading && hasMore}
      loadingMore={loadingMore}
      onClose={onClose}
      onLoadMore={handleLoadMore}
      header={
        aiEnabled ? (
          <Suspense fallback={null}>
            <SearchAIOverview
              askingAI={askingAI}
              loading={searchPending || (currentResults && summaryLoading)}
              query={searchValue}
              sources={overviewSources}
              summary={visibleSummary}
              canAskFollowUp={canAskFollowUp}
              onClose={onClose}
              onAskAI={(sources) => onAskAI(searchValue, sources)}
            />
          </Suspense>
        ) : undefined
      }
    />
  );
}

export default BestMatch;
