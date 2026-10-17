import { debounce } from 'lodash-es';
import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { SearchService, ViewService } from '@/application/services/domains';
import type {
  SearchDocumentPageResponse,
  SearchDocumentResponseItem,
  SearchSummary,
} from '@/application/services/domains/search';
import { View } from '@/application/types';
import { isRecordNotFoundError } from '@/application/utils/error-utils';
import { getDatabaseIdFromExtra } from '@/application/view-utils';
import { notify } from '@/components/_shared/notify';
import { findView } from '@/components/_shared/outline/utils';
import { isSpaceView } from '@/components/ai-chat/rag-scope';
import type { AIChatRagSource } from '@/components/ai-chat/rag-scope';
import { useAIEnabled, useAppOutline, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import type { SearchOverviewSource } from '@/components/app/search/SearchAIOverview';
import SearchStatusNotice from '@/components/app/search/SearchStatusNotice';
import { useSearchAccessScope } from '@/components/app/search/useSearchAccessScope';
import ViewList, { SearchViewListItem } from '@/components/app/search/ViewList';
import { isPermissionError } from '@/utils/change-failure';
import { getAPIErrorCode } from '@/utils/errors';

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

/**
 * Reads one view a result may open. `known` holds this access scope's answers: a loaded view, or
 * `null` for an id the server says is no view. A cancelled, offline or failed read is not kept,
 * so the next search asks again.
 */
async function lookUpResultView(
  workspaceId: string,
  viewId: string,
  known: Map<string, View | null>,
  signal: AbortSignal
): Promise<View | undefined> {
  try {
    // A cancellable read skips the shared cache, so use a fresh entry the app already has.
    const cached = ViewService.getCached(workspaceId, viewId);

    if (cached) return cached;
    if (known.has(viewId)) return known.get(viewId) ?? undefined;
    const view = await ViewService.get(workspaceId, viewId, signal);

    known.set(viewId, view);
    return view;
  } catch (error) {
    if (isRecordNotFoundError(error)) known.set(viewId, null);
    return undefined;
  }
}

async function loadSearchResultView(
  item: SearchDocumentResponseItem,
  currentWorkspaceId: string,
  isCurrent: () => boolean,
  lookUpView: (viewId: string) => Promise<View | undefined>
): Promise<View | undefined> {
  const workspaceId = item.workspace_id || currentWorkspaceId;

  if (workspaceId !== currentWorkspaceId) return;
  for (const viewId of getSearchResultViewIdCandidates(item)) {
    if (!isCurrent()) return;
    const view = await lookUpView(viewId);

    // Search can return database/object ids that are not view ids. Try the next candidate.
    if (view) return view;
  }
}

async function loadSummarySourceViews(
  outline: View[],
  currentWorkspaceId: string,
  sourceIds: string[],
  searchResults: SearchDocumentResponseItem[],
  signal: AbortSignal
): Promise<Map<string, View>> {
  const resultSourceIds = new Set(
    searchResults.flatMap((item) => [item.object_id, item.database_row_id].filter(Boolean) as string[])
  );
  const unresolvedSourceIds = Array.from(
    new Set(sourceIds.filter((sourceId) => !resultSourceIds.has(sourceId) && !findView(outline, sourceId)))
  );

  if (unresolvedSourceIds.length === 0) return new Map();

  try {
    const views = await ViewService.getMultiple(currentWorkspaceId, unresolvedSourceIds, 0, signal);

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
  askingAI,
  onAskAI,
}: {
  onClose: () => void;
  searchValue: string;
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
  const [revalidating, setRevalidating] = useState(false);
  // A query whose results are missing because the connection was lost (skipped offline, or failed
  // when it dropped). It runs again once the browser is back online after `epoch`.
  const [reconnectRetry, setReconnectRetry] = useState<{ query: string; epoch: number }>();
  const aiEnabled = useAIEnabled();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const { scope, isCurrent, refreshKey, online, onlineEpoch } = useSearchAccessScope(currentWorkspaceId);
  const onlineEpochRef = useRef(onlineEpoch);

  useLayoutEffect(() => {
    onlineEpochRef.current = onlineEpoch;
  }, [onlineEpoch]);
  const [responseScope, setResponseScope] = useState(scope);
  const responseIsCurrent = responseScope === scope;
  const searchSeqRef = useRef(0);
  const requestController = useRef<AbortController>();
  // The response on screen: a background revalidation reloads exactly this query and page count.
  const shownRef = useRef<{ scope: object; query: string; pages: number }>();
  // Views read for results missing from the outline, kept while the access scope lasts so a refined
  // query or the next page does not read them again.
  const knownResultViewsRef = useRef<{ scope: object; views: Map<string, View | null> }>();
  const searchValueRef = useRef(searchValue);
  const [keywordSearchStreamId] = useState(() => createSearchStreamId('best-match-keyword'));

  useLayoutEffect(() => {
    searchValueRef.current = searchValue;
  }, [searchValue]);

  // Metadata helps route results but is not a search input. Read the latest
  // outline when resolving a response without restarting requests on renames.
  const loadResultViews = useCallback(
    async (results: SearchDocumentResponseItem[], signal: AbortSignal) => {
      const views = new Map<string, View>();

      if (!currentWorkspaceId) return views;
      if (knownResultViewsRef.current?.scope !== scope) knownResultViewsRef.current = { scope, views: new Map() };
      const known = knownResultViewsRef.current.views;
      // Results share reads: every row of one database falls back to the same database view.
      const lookups = new Map<string, Promise<View | undefined>>();
      const lookUpView = (viewId: string) => {
        let lookup = lookups.get(viewId);

        if (!lookup) {
          lookup = lookUpResultView(currentWorkspaceId, viewId, known, signal);
          lookups.set(viewId, lookup);
        }

        return lookup;
      };

      const resolvedViews = await Promise.all(
        results.map(
          async (item) =>
            resolveSearchResultView(outlineRef.current || [], item) ||
            loadSearchResultView(item, currentWorkspaceId, isCurrent, lookUpView)
        )
      );

      for (const [index, item] of results.entries()) {
        const view = resolvedViews[index];

        if (view) views.set(searchResultKey(item), view);
      }

      return views;
    },
    [currentWorkspaceId, isCurrent, scope]
  );

  const items = useMemo<SearchViewListItem[]>(() => {
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
  }, [outline, resultViews, searchResults, t]);

  /** Replaces the response, or with `revalidate` reloads the shown query and pages in the background
   * (missed permission hints after a reconnect) and keeps the current response until it completes. */
  const runSearch = useCallback(
    async (searchTerm: string, revalidate = false) => {
      if (!currentWorkspaceId || !isCurrent()) return;
      const shown = shownRef.current;
      const background = revalidate && Boolean(searchTerm) && shown?.scope === scope && shown.query === searchTerm;

      // A revalidation that cannot run leaves the shown response alone, including its pending summary.
      if (background && !navigator.onLine) return;
      const searchSeq = searchSeqRef.current + 1;

      searchSeqRef.current = searchSeq;
      requestController.current?.abort();
      const controller = new AbortController();

      requestController.current = controller;
      const isLatest = () => isCurrent() && searchSeqRef.current === searchSeq;
      const pageCount = background && shown ? shown.pages : 1;
      const startedEpoch = onlineEpochRef.current;

      setLoadingMore(false);
      if (!background) {
        shownRef.current = undefined;
        setResponseScope(scope);
        setSummary(null);
        setSummarySourceViews(new Map());
        setResultViews(new Map());
        setSummaryLoading(false);
        setSearchResults([]);
        setHasMore(false);
        setNextOffset(null);
        setRevalidating(false);
      }

      if (!searchTerm) {
        setReconnectRetry(undefined);
        setLoading(false);
        return;
      }

      if (!navigator.onLine) {
        // Offline is not "no results": retry after reconnecting.
        setReconnectRetry({ query: searchTerm, epoch: startedEpoch });
        setLoading(false);
        return;
      }

      setReconnectRetry(undefined);
      if (background) setRevalidating(true);
      else setLoading(true);

      const summaryRequest = aiEnabled
        ? SearchService.generateSearchSummary(currentWorkspaceId, searchTerm, controller.signal).catch(() => null)
        : null;
      let res: SearchDocumentResponseItem[];

      try {
        let requestedOffset = 0;
        let page = await SearchService.searchWorkspaceDocumentPage(
          currentWorkspaceId,
          searchTerm,
          requestedOffset,
          keywordSearchStreamId,
          controller.signal
        );

        if (!isLatest()) return;
        res = mergeSearchResults([], page.items || []);
        let pages = 1;

        while (pages < pageCount && canLoadMoreSearchResults(page, requestedOffset)) {
          requestedOffset = page.next_offset as number;
          page = await SearchService.searchWorkspaceDocumentPage(
            currentWorkspaceId,
            searchTerm,
            requestedOffset,
            keywordSearchStreamId,
            controller.signal
          );
          if (!isLatest()) return;
          res = mergeSearchResults(res, page.items || []);
          pages += 1;
        }

        const lastPage = page;
        const lastOffset = requestedOffset;
        const views = await loadResultViews(res, controller.signal);

        if (!isLatest()) return;
        setSearchResults(res);
        setResultViews(views);
        setHasMore(canLoadMoreSearchResults(lastPage, lastOffset));
        setNextOffset(lastPage.next_offset ?? null);
        shownRef.current = { scope, query: searchTerm, pages };
        // Publish keywords immediately. The previous summary belongs to the previous results.
        setSummary(null);
        setSummarySourceViews(new Map());
        setSummaryLoading(summaryRequest !== null);
        // eslint-disable-next-line
      } catch (e: any) {
        if (!isLatest()) return;
        if (background && !isPermissionError(e)) {
          // A failed revalidation can keep the previous response unless access was refused.
          // Its pending summary was cancelled for this run's, so stop waiting.
          setSummaryLoading(false);
          return;
        }

        controller.abort();
        const offline = !navigator.onLine;

        // A dropped connection is not "no results" either: run the query again once the browser is
        // back online. While it stays online (an unreachable server) nothing retries on its own.
        if (offline || getAPIErrorCode(e) === -1) setReconnectRetry({ query: searchTerm, epoch: startedEpoch });
        // The offline notice explains a failure while offline.
        if (!offline) notify.error(e.message);
        shownRef.current = undefined;
        setSearchResults([]);
        setResultViews(new Map());
        setSummary(null);
        setSummarySourceViews(new Map());
        setSummaryLoading(false);
        setHasMore(false);
        setNextOffset(null);
        return;
      } finally {
        if (isLatest()) {
          setLoading(false);
          setLoadingMore(false);
          setRevalidating(false);
        }
      }

      // Summary work has its own loading state: it must not block keyword pagination or reset
      // loadingMore when a page request starts while the summary is still being generated.
      if (!summaryRequest) return;
      const summaryResult = await summaryRequest;

      if (!isLatest()) return;
      const nextSummary = summaryResult?.summaries[0] || null;
      const sourceViews = nextSummary
        ? await loadSummarySourceViews(
            outlineRef.current || [],
            currentWorkspaceId,
            nextSummary.sources,
            res,
            controller.signal
          )
        : new Map<string, View>();

      if (!isLatest()) return;
      setSummarySourceViews(sourceViews);
      setSummary(nextSummary);
      setSummaryLoading(false);
    },
    [aiEnabled, loadResultViews, currentWorkspaceId, keywordSearchStreamId, scope, isCurrent]
  );

  const handleLoadMore = useCallback(async () => {
    if (
      !isCurrent() || !responseIsCurrent || !currentWorkspaceId || !searchValue ||
      loading || loadingMore || revalidating || !hasMore || nextOffset === null
    ) return;

    const searchSeq = searchSeqRef.current;
    const signal = requestController.current?.signal;

    if (!signal || signal.aborted) return;

    setLoadingMore(true);

    try {
      const page = await SearchService.searchWorkspaceDocumentPage(
        currentWorkspaceId,
        searchValue,
        nextOffset,
        keywordSearchStreamId,
        signal
      );

      if (!isCurrent() || searchSeqRef.current !== searchSeq) return;

      const mergedResults = mergeSearchResults(searchResults, page.items || []);
      const views = await loadResultViews(page.items || [], signal);

      if (!isCurrent() || searchSeqRef.current !== searchSeq) return;

      setSearchResults(mergedResults);
      setResultViews((previous) => new Map([...previous, ...views]));
      setHasMore(canLoadMoreSearchResults(page, nextOffset));
      setNextOffset(page.next_offset ?? null);
      if (shownRef.current) shownRef.current = { ...shownRef.current, pages: shownRef.current.pages + 1 };
      // eslint-disable-next-line
    } catch (e: any) {
      if (!isCurrent() || searchSeqRef.current !== searchSeq) return;
      notify.error(e.message);
    } finally {
      if (isCurrent() && searchSeqRef.current === searchSeq) {
        setLoadingMore(false);
      }
    }
  }, [
    loadResultViews,
    currentWorkspaceId,
    hasMore,
    keywordSearchStreamId,
    loading,
    loadingMore,
    nextOffset,
    revalidating,
    searchResults,
    searchValue,
    isCurrent,
    responseIsCurrent,
  ]);

  const debounceSearch = useMemo(() => {
    return debounce(runSearch, 300);
  }, [runSearch]);

  useEffect(() => {
    void debounceSearch(searchValue);

    return () => {
      debounceSearch.cancel();
      requestController.current?.abort();
      // Ignore old responses immediately, including during the next debounce
      // interval and after the search dialog has unmounted.
      searchSeqRef.current += 1;
    };
  }, [searchValue, debounceSearch]);

  // Permission hints sent while the socket was down are not replayed: revalidate after reconnecting.
  const handledRefreshKey = useRef(refreshKey);

  useEffect(() => {
    if (handledRefreshKey.current === refreshKey) return;
    handledRefreshKey.current = refreshKey;
    // A missed hint may also have changed what a result opens.
    knownResultViewsRef.current = undefined;
    debounceSearch.cancel();
    void runSearch(searchValueRef.current, true);
  }, [debounceSearch, refreshKey, runSearch]);

  const retryAfterReconnect = online && reconnectRetry !== undefined && reconnectRetry.epoch !== onlineEpoch;

  useEffect(() => {
    if (!retryAfterReconnect) return;
    debounceSearch.cancel();
    void runSearch(searchValueRef.current, true);
  }, [debounceSearch, retryAfterReconnect, runSearch]);

  const overviewSources = useMemo<SearchOverviewSource[]>(() => {
    if (!summary) return [];

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
  }, [outline, resultViews, searchResults, summary, summarySourceViews, t]);

  const summarySourceCount = new Set(summary?.sources || []).size;
  const canAskFollowUp = summarySourceCount > 0 && overviewSources.length === summarySourceCount;
  const showLoading = loading || retryAfterReconnect || !responseIsCurrent;

  if (!online && (!responseIsCurrent || searchResults.length === 0)) {
    return <SearchStatusNotice title={t('commandPalette.bestMatches')} message={t('search.offlineResults')} />;
  }

  return (
    <ViewList
      items={showLoading ? undefined : items}
      loading={showLoading}
      query={searchValue}
      title={t('commandPalette.bestMatches')}
      hasMore={responseIsCurrent && hasMore}
      loadingMore={loadingMore || revalidating}
      onClose={onClose}
      onLoadMore={handleLoadMore}
      header={
        aiEnabled ? (
          <>
            {!online && (
              <div role={'status'} className={'px-4 pt-3 text-xs text-text-secondary'}>
                {t('search.offlineAskAI')}
              </div>
            )}
            <Suspense fallback={null}>
              <SearchAIOverview
                askingAI={askingAI || !online}
                loading={showLoading || summaryLoading}
                query={searchValue}
                sources={responseIsCurrent ? overviewSources : []}
                summary={responseIsCurrent ? summary : null}
                canAskFollowUp={responseIsCurrent && canAskFollowUp}
                onClose={onClose}
                onAskAI={(sources) => {
                  if (isCurrent() && responseIsCurrent && online) onAskAI(searchValue, sources);
                }}
              />
            </Suspense>
          </>
        ) : undefined
      }
    />
  );
}

export default BestMatch;
