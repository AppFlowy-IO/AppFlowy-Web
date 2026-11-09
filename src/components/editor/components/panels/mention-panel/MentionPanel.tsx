import { Button, Divider } from '@mui/material';
import { PopoverOrigin } from '@mui/material/Popover/Popover';
import dayjs from 'dayjs';
import { ReactNode, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Editor as SlateEditor, Element as SlateElement, Transforms } from 'slate';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { APP_EVENTS } from '@/application/constants';
import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import {
  Mention,
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
  MentionType,
  View,
  ViewLayout,
} from '@/application/types';
import { isDashboardOwnedView, isDatabaseLayout, isEmbeddedView } from '@/application/view-utils';
import { ReactComponent as CloudOffIcon } from '@/assets/icons/cloud_off.svg';
import { ReactComponent as DateIcon } from '@/assets/icons/date.svg';
import { ReactComponent as ArrowIcon } from '@/assets/icons/forward_arrow.svg';
import { ReactComponent as GridIcon } from '@/assets/icons/grid.svg';
import { ReactComponent as LinkIcon } from '@/assets/icons/link.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as DocumentIcon } from '@/assets/icons/page.svg';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { ReactComponent as ReminderIcon } from '@/assets/icons/reminder_clock.svg';
import { ReactComponent as TimeIcon } from '@/assets/icons/time.svg';
import { ReactComponent as WarningIcon } from '@/assets/icons/warning.svg';
import { calculateOptimalOrigins, Popover } from '@/components/_shared/popover';
import { usePanelContext } from '@/components/editor/components/panels/Panels.hooks';
import { PanelType } from '@/components/editor/components/panels/PanelsContext';
import { useEditorContext } from '@/components/editor/EditorContext';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Switch } from '@/components/ui/switch';

import { useSendMentionNotification } from './mention-notification-preference';
import { MENTION_TYPED_LANES, mentionRequestLane, MentionRequestLanes } from './mentionRequestLanes';
import {
  ensureMentionSearchCacheScope,
  getCachedMentionSearch,
  getCachedMentionSections,
  mentionSearchCacheStamp,
  MentionSearchCacheStamp,
  mentionSearchRetryLaterRemainingMs,
  setCachedMentionSections,
  startMentionSearchRefresh,
  subscribeMentionSearchCacheInvalidation,
  withoutMentionView,
  withoutRevokedMentionViews,
} from './mentionSearchCache';
import { fetchMentionSearchSections, MentionSectionsFetchResult } from './mentionSearchFetch';
import {
  buildMentionSearchCacheScopeKey,
  buildMentionSearchRequests,
  buildMentionSearchRequestsCacheKey,
  flattenMentionSearchSections,
  getMentionSearchResultDisplayTitle,
  MentionOptionSelection,
  MentionPanelSearchResult,
  normalizeMentionSearchSectionsForPicker,
  reconcileMentionOptionSelection,
} from './mentionUtils';
import { useNotifyPersonMention } from './useNotifyPersonMention';

enum MentionTag {
  Result = 'result',
}

const MENTION_SEARCH_LIMIT = 20;
const PAGE_RESULT_COLLAPSE_LIMIT = 4;
/** The key of the "Suggestions unavailable · Retry" row, which holds no position either. */
const MENTION_RETRY_OPTION_KEY = 'status|retry';

/**
 * What the panel's search is showing:
 * - `loading`: a search is pending and nothing failed yet;
 * - `ok`: the server answered completely, or a cached answer is shown;
 * - `unavailable`: some suggestions are missing, and a Retry row is offered;
 * - `busy`: the server asked to wait, and the search is sent again when the countdown ends;
 * - `offline`: the browser is offline; the search is sent again when it is back online.
 */
type MentionSearchStatus = 'idle' | 'loading' | 'ok' | 'unavailable' | 'busy' | 'offline';

type MentionPanelOption =
  | {
      kind: 'result';
      key: string;
      navKey: string;
      result: MentionPanelSearchResult;
    }
  | {
      kind: 'morePages';
      key: string;
      remainingCount: number;
      // The first collapsed result: Enter on this row expands the section and highlights it.
      firstHidden: MentionOptionSelection;
    }
  | {
      kind: 'retry';
      key: string;
    }
  | {
      kind: 'createPage';
      key: string;
      createType: MentionType.childPage | MentionType.PageRef;
    };

type MentionPanelResultOption = Extract<MentionPanelOption, { kind: 'result' | 'morePages' }>;
type MentionPanelMorePagesOption = Extract<MentionPanelOption, { kind: 'morePages' }>;
type MentionPanelRetryOption = Extract<MentionPanelOption, { kind: 'retry' }>;
type MentionPanelCreatePageOption = Extract<MentionPanelOption, { kind: 'createPage' }>;

function hasMentionItems(sections: MentionSearchSection[]) {
  return sections.some((section) => section.items.length > 0);
}

function mentionOptionSelection(option: MentionPanelOption): MentionOptionSelection {
  return option.kind === 'result' ? { key: option.key, navKey: option.navKey } : { key: option.key };
}

interface MentionPanelResultSection {
  section: MentionSearchSection;
  options: MentionPanelResultOption[];
}

const DEFAULT_MENTION_INCLUDE = [
  MentionTargetKind.Person,
  MentionTargetKind.Page,
  MentionTargetKind.Database,
  MentionTargetKind.DatabaseRow,
  MentionTargetKind.Date,
  MentionTargetKind.Reminder,
  MentionTargetKind.ExternalLink,
];

const MENTION_INCLUDE_WITHOUT_REMINDERS = DEFAULT_MENTION_INCLUDE.filter((kind) => kind !== MentionTargetKind.Reminder);

const PAGE_REFERENCE_INCLUDE = [MentionTargetKind.Page, MentionTargetKind.Database, MentionTargetKind.DatabaseRow];

function getMentionablePageViews(views: View[] = []) {
  const mentionable: View[] = [];
  const collectMentionable = (items: View[], parentIsDatabase: boolean) => {
    items.forEach((view) => {
      const isDatabase = isDatabaseLayout(view.layout);
      // A dashboard-owned view is widget data, hidden like an embedded one.
      const skip = view.extra?.is_space || parentIsDatabase || isEmbeddedView(view) || isDashboardOwnedView(view);

      if (!skip) {
        mentionable.push(view);
      }

      collectMentionable(view.children || [], parentIsDatabase || isDatabase);
    });
  };

  collectMentionable(views, false);

  return Array.from(new Map(mentionable.map((view) => [view.view_id, view])).values()).sort(
    (left, right) => (Date.parse(right.last_edited_time ?? '') || 0) - (Date.parse(left.last_edited_time ?? '') || 0)
  );
}

function viewToPageMentionItem(view: View): MentionSearchResultItem {
  return {
    kind: MentionTargetKind.Page,
    object_id: view.view_id,
    title: view.name || '',
    mention: {
      type: MentionTargetKind.Page,
      page_id: view.view_id,
    },
  };
}

function getDateMentionItems(t: (key: string) => string, query: string): MentionSearchResultItem[] {
  const items: MentionSearchResultItem[] = [
    {
      kind: MentionTargetKind.Date,
      object_id: 'today',
      title: t('relativeDates.today'),
      mention: {
        type: MentionTargetKind.Date,
        start: dayjs().toISOString(),
      },
    },
    {
      kind: MentionTargetKind.Date,
      object_id: 'tomorrow',
      title: t('relativeDates.tomorrow'),
      mention: {
        type: MentionTargetKind.Date,
        start: dayjs().add(1, 'day').toISOString(),
      },
    },
    {
      kind: MentionTargetKind.Date,
      object_id: 'yesterday',
      title: t('relativeDates.yesterday'),
      mention: {
        type: MentionTargetKind.Date,
        start: dayjs().subtract(1, 'day').toISOString(),
      },
    },
  ];

  return items.filter((item) => !query || item.title.toLowerCase().includes(query));
}

function getSelectedBlockId(editor: YjsEditor): string | undefined {
  const entry = SlateEditor.above(editor, {
    match: (value) => SlateElement.isElement(value) && typeof (value as { blockId?: unknown }).blockId === 'string',
  });

  return (entry?.[0] as { blockId?: string } | undefined)?.blockId;
}

function isImageSource(value?: string) {
  if (!value) return false;

  return /^https?:\/\//i.test(value) || value.startsWith('data:') || value.startsWith('blob:') || value.startsWith('/');
}

function MentionPersonAvatar({ item, title }: { item: MentionSearchResultItem; title: string }) {
  const displayName = title || item.title || item.subtitle || item.object_id || '?';

  return (
    <Avatar size={'sm'} shape={'circle'} className={'h-6 w-6 min-w-6'}>
      <AvatarImage src={isImageSource(item.icon) ? item.icon : undefined} alt={displayName} />
      <AvatarFallback name={displayName} className={'text-xs font-medium'}>
        {displayName}
      </AvatarFallback>
    </Avatar>
  );
}

function MentionResultIcon({ item, title }: { item: MentionSearchResultItem; title: string }) {
  const className = 'h-5 w-5 min-w-5 text-icon-primary';
  const { kind } = item;

  switch (kind) {
    case MentionTargetKind.Person:
      return <MentionPersonAvatar item={item} title={title} />;
    case MentionTargetKind.Database:
    case MentionTargetKind.DatabaseRow:
      // Desktop parity: database and database-row results render inline in
      // the Pages section with a grid icon.
      return <GridIcon className={className} />;
    case MentionTargetKind.Date:
      return <DateIcon className={className} />;
    case MentionTargetKind.Reminder:
      return <ReminderIcon className={className} />;
    case MentionTargetKind.ExternalLink:
      return <LinkIcon className={className} />;
    case MentionTargetKind.Page:
    default:
      return <DocumentIcon className={className} />;
  }
}

function MentionResultButton({
  result,
  optionKey,
  index,
  selected,
  onClick,
}: {
  result: MentionPanelSearchResult;
  optionKey: string;
  index: number;
  selected: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const { item } = result;
  const subtitle =
    item.kind === MentionTargetKind.Page ||
    item.kind === MentionTargetKind.Database ||
    item.kind === MentionTargetKind.DatabaseRow
      ? undefined
      : item.subtitle;
  const title = getMentionSearchResultDisplayTitle(item, t('menuAppHeader.defaultNewPageName'));

  return (
    <Button
      color={'inherit'}
      size={'small'}
      data-option-index={index}
      data-option-key={optionKey}
      data-selected={selected || undefined}
      data-option-kind={item.kind}
      startIcon={<MentionResultIcon item={item} title={title} />}
      className={`min-h-[40px] scroll-m-2 justify-start rounded-[8px] bg-fill-content px-3 text-text-primary hover:bg-fill-content-hover ${
        selected ? 'bg-fill-content-hover' : ''
      }`}
      onClick={onClick}
    >
      <span className={'flex min-w-0 flex-col items-start'}>
        <span className={'max-w-[280px] truncate'}>{title}</span>
        {subtitle && <span className={'max-w-[280px] truncate text-xs text-text-secondary'}>{subtitle}</span>}
      </span>
    </Button>
  );
}

function MentionMoreResultsButton({
  remainingCount,
  optionKey,
  index,
  selected,
  onClick,
}: {
  remainingCount: number;
  optionKey: string;
  index: number;
  selected: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const label = t('document.mention.moreResults', {
    count: remainingCount,
    defaultValue: '{{count}} more results...',
  });

  return (
    <Button
      color={'inherit'}
      size={'small'}
      data-option-index={index}
      data-option-key={optionKey}
      data-selected={selected || undefined}
      startIcon={<MoreIcon className={'h-5 w-5 min-w-5 text-icon-tertiary'} />}
      className={`min-h-[40px] scroll-m-2 justify-start rounded-[8px] bg-fill-content px-3 text-text-tertiary hover:bg-fill-content-hover ${
        selected ? 'bg-fill-content-hover' : ''
      }`}
      onClick={onClick}
    >
      <span className={'max-w-[280px] truncate'}>{label}</span>
    </Button>
  );
}

function MentionCreatePageButton({
  createType,
  searchText,
  optionKey,
  index,
  selected,
  onClick,
}: {
  createType: MentionType.childPage | MentionType.PageRef;
  searchText?: string;
  optionKey: string;
  index: number;
  selected: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const isChildPage = createType === MentionType.childPage;
  const pageName = searchText ? `"${searchText}"` : 'new';

  return (
    <Button
      color={'inherit'}
      size={'small'}
      data-option-index={index}
      data-option-key={optionKey}
      data-selected={selected || undefined}
      startIcon={
        isChildPage ? (
          <AddIcon className={'h-5 w-5 min-w-5 text-icon-primary'} />
        ) : (
          <ArrowIcon className={'mx-0.5 h-5 w-5 min-w-5 text-icon-primary'} />
        )
      }
      className={`min-h-[40px] scroll-m-2 justify-start rounded-[8px] bg-fill-content px-3 text-text-primary hover:bg-fill-content-hover ${
        selected ? 'bg-fill-content-hover' : ''
      }`}
      onClick={onClick}
    >
      <span className={'flex min-w-0 items-center'}>
        <span>{t('button.create')}</span>
        <span className={'mx-1 max-w-[160px] truncate'}>{pageName}</span>
        <span className={'truncate'}>{isChildPage ? t('document.slashMenu.subPage.keyword1') : 'page in...'}</span>
      </span>
    </Button>
  );
}

/** "Suggestions unavailable · Retry", or "You're offline · Retry": a keyboard-selectable option. */
function MentionRetryButton({
  offline,
  retrying,
  optionKey,
  index,
  selected,
  onClick,
}: {
  offline: boolean;
  retrying: boolean;
  optionKey: string;
  index: number;
  selected: boolean;
  onClick: () => void;
}) {
  const { t } = useTranslation();
  const StatusIcon = offline ? CloudOffIcon : WarningIcon;

  return (
    <Button
      color={'inherit'}
      size={'small'}
      data-option-index={index}
      data-option-key={optionKey}
      data-selected={selected || undefined}
      data-testid={'mention-panel-retry'}
      data-status={offline ? 'offline' : 'unavailable'}
      startIcon={<StatusIcon className={'h-5 w-5 min-w-5 text-icon-tertiary'} />}
      className={`min-h-[40px] scroll-m-2 justify-start rounded-[8px] bg-fill-content px-3 text-text-secondary hover:bg-fill-content-hover ${
        selected ? 'bg-fill-content-hover' : ''
      }`}
      onClick={onClick}
    >
      {retrying ? (
        <span className={'truncate'}>{t('document.mention.retrying')}</span>
      ) : (
        <span className={'flex min-w-0 items-center gap-1'}>
          <span className={'truncate'}>
            {offline ? t('document.mention.offline') : t('document.mention.suggestionsUnavailable')}
          </span>
          <span aria-hidden={'true'}>·</span>
          <span className={'shrink-0 text-text-action'}>{t('document.mention.retry')}</span>
        </span>
      )}
    </Button>
  );
}

/** "Busy, retrying in N s" while the server's RetryLater cooldown runs, then "Retrying…". */
function MentionBusyRow({ seconds }: { seconds: number }) {
  const { t } = useTranslation();

  return (
    <div
      role={'status'}
      data-testid={'mention-panel-busy'}
      data-retry-in-seconds={seconds}
      className={'flex min-h-[40px] items-center gap-2 px-3 text-sm text-text-secondary'}
    >
      <TimeIcon className={'h-5 w-5 min-w-5 text-icon-tertiary'} />
      <span className={'truncate'}>
        {seconds > 0 ? t('document.mention.busyRetryingIn', { seconds }) : t('document.mention.retrying')}
      </span>
    </div>
  );
}

function MentionSectionTitle({ section, trailing }: { section: MentionSearchSection; trailing?: ReactNode }) {
  return (
    <div className={'flex min-h-7 items-center px-0 text-sm font-semibold text-text-tertiary'}>
      <span className={'truncate'}>{section.title}</span>
      {trailing}
    </div>
  );
}

function MentionPanelLoadingState() {
  return (
    <div className={'flex min-h-[136px] flex-col gap-3 px-4 py-3'} aria-hidden={'true'}>
      {Array.from({ length: 3 }, (_, index) => (
        <div key={index} className={'flex items-center gap-3'}>
          <div className={'h-7 w-7 shrink-0 animate-pulse rounded-full bg-fill-content-hover'} />
          <div className={'flex min-w-0 flex-1 flex-col gap-2'}>
            <div className={'h-3 w-32 animate-pulse rounded bg-fill-content-hover'} />
            <div className={'h-2.5 w-44 animate-pulse rounded bg-fill-content-hover'} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function MentionPanel({
  notifyOnInsert = true,
  onPersonPicked,
}: { notifyOnInsert?: boolean; onPersonPicked?: (personId: string, requireNotification: boolean) => void } = {}) {
  const { isPanelOpen, panelPosition, closePanel, searchText, removeContent, activePanel } = usePanelContext();
  const {
    workspaceId,
    viewId,
    searchMentions,
    mentionContext,
    loadViews,
    addPage,
    openPageModal,
    enableReminderMentions,
    eventEmitter,
  } = useEditorContext();
  const currentUser = useCurrentUserOptional();
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const open = isPanelOpen(PanelType.Mention) || isPanelOpen(PanelType.PageReference);
  const useLocalMentionFallback = open && !searchMentions && Boolean(loadViews);
  const hasMentionPanelSource = Boolean(searchMentions) || useLocalMentionFallback;
  // The highlight is held by option key, never by position. The ref mirrors it at once for the
  // native keydown listener, which can run before React renders the change.
  const selectionRef = useRef<MentionOptionSelection | null>(null);
  const [selection, setSelectionState] = useState<MentionOptionSelection | null>(null);
  const setSelection = useCallback((next: MentionOptionSelection | null) => {
    selectionRef.current = next;
    setSelectionState(next);
  }, []);
  const editor = useSlateStatic() as YjsEditor;
  const [mentionSections, setMentionSections] = useState<MentionSearchSection[]>([]);
  const [searchStatus, setSearchStatus] = useState<MentionSearchStatus>('idle');
  // An explicit retry (the Retry row, or the browser coming back online) is pending.
  const [retrying, setRetrying] = useState(false);
  // When the RetryLater cooldown of a busy search ends, and `busyClock` is the countdown's clock.
  const [busyUntil, setBusyUntil] = useState<number | undefined>(undefined);
  const [busyClock, setBusyClock] = useState(() => Date.now());
  // Bumped to send the same search again; the search effect depends on it.
  const [retryNonce, setRetryNonce] = useState(0);
  const lastSearchRef = useRef<{ key: string; nonce: number } | undefined>(undefined);
  const [showMorePages, setShowMorePages] = useState(false);
  const [localFallbackViews, setLocalFallbackViews] = useState<View[]>([]);
  const mentionSearchRequestIdRef = useRef(0);
  // Each opening of the panel is a session with its own request lanes, so it sends on new streams.
  const mentionRequestLanes = useMemo(() => (open ? new MentionRequestLanes() : null), [open]);
  const hasMentionSearchQuery = Boolean(searchText?.trim());
  const mentionInclude = activePanel === PanelType.PageReference
    ? PAGE_REFERENCE_INCLUDE
    : enableReminderMentions === false ? MENTION_INCLUDE_WITHOUT_REMINDERS : DEFAULT_MENTION_INCLUDE;
  const mentionSearchRequest = useMemo(
    () => ({
      query: searchText ?? '',
      limit: MENTION_SEARCH_LIMIT,
      include: mentionInclude,
      context: mentionContext,
    }),
    [mentionContext, mentionInclude, searchText]
  );
  const mentionSearchRequests = useMemo(() => buildMentionSearchRequests(mentionSearchRequest), [mentionSearchRequest]);
  const mentionSearchCacheScope = useMemo(
    () => buildMentionSearchCacheScopeKey({ workspaceId, userId: currentUser?.uuid }),
    [currentUser?.uuid, workspaceId]
  );
  const mentionSearchCacheKey = useMemo(
    () =>
      buildMentionSearchRequestsCacheKey(mentionSearchRequests, {
        workspaceId,
        userId: currentUser?.uuid,
      }),
    [currentUser?.uuid, mentionSearchRequests, workspaceId]
  );
  const mentionableFallbackViews = useMemo(() => getMentionablePageViews(localFallbackViews), [localFallbackViews]);
  const localFallbackMentionSections = useMemo(() => {
    if (!useLocalMentionFallback) return [];

    const query = searchText?.trim().toLowerCase() ?? '';
    const includeDates = activePanel === PanelType.Mention;
    const pageItems = mentionableFallbackViews
      .filter((view) => !query || (view.name ?? '').toLowerCase().includes(query))
      .map(viewToPageMentionItem);
    const dateItems = includeDates ? getDateMentionItems(t, query) : [];
    const sections: MentionSearchSection[] = [];

    if (pageItems.length > 0 || !includeDates) {
      sections.push({
        kind: MentionSearchSectionKind.Pages,
        title: t('inlineActions.recentPages'),
        items: pageItems,
        has_more: false,
        status: 'ready',
      });
    }

    if (dateItems.length > 0) {
      sections.push({
        kind: MentionSearchSectionKind.Dates,
        title: t('inlineActions.date'),
        items: dateItems,
        has_more: false,
        status: 'ready',
      });
    }

    return sections;
  }, [activePanel, mentionableFallbackViews, searchText, t, useLocalMentionFallback]);
  const sourceMentionSections = useLocalMentionFallback ? localFallbackMentionSections : mentionSections;
  const pickerMentionSections = useMemo(
    () => normalizeMentionSearchSectionsForPicker(
      enableReminderMentions === false
        ? sourceMentionSections.map((section) => ({
            ...section,
            items: section.items.filter((item) => item.kind !== MentionTargetKind.Reminder),
          }))
        : sourceMentionSections
    ),
    [sourceMentionSections, enableReminderMentions]
  );

  useEffect(() => {
    if (!open) {
      setSelection(null);
      setShowMorePages(false);
    }
  }, [open, setSelection]);

  useEffect(() => {
    setShowMorePages(false);
  }, [mentionSearchCacheKey]);

  // One listener set per app emitter marks cached answers stale on workspace events.
  useEffect(() => {
    subscribeMentionSearchCacheInvalidation(eventEmitter);
  }, [eventEmitter]);

  // A view the user loses access to leaves the open panel at once, as it leaves the cache. Answers
  // to requests sent before the revoke leave it out too (see fetchMentionSections).
  useEffect(() => {
    if (!open || !eventEmitter) return;

    const dropRevokedView = (payload?: { viewId?: string }) => {
      const revokedViewId = payload?.viewId;

      if (revokedViewId) setMentionSections((sections) => withoutMentionView(sections, revokedViewId));
    };

    eventEmitter.on(APP_EVENTS.VIEW_ACCESS_REVOKED, dropRevokedView);
    return () => {
      eventEmitter.off(APP_EVENTS.VIEW_ACCESS_REVOKED, dropRevokedView);
    };
  }, [eventEmitter, open]);

  // Sends the panel's search again: from the Retry row, or when the browser is back online.
  const retrySearch = useCallback(() => {
    setRetrying(true);
    setRetryNonce((nonce) => nonce + 1);
  }, []);

  useEffect(() => {
    if (!open || !searchMentions || !mentionRequestLanes) {
      if (useLocalMentionFallback) return;

      setMentionSections([]);
      setSearchStatus('idle');
      setRetrying(false);
      setBusyUntil(undefined);
      lastSearchRef.current = undefined;
      return;
    }

    ensureMentionSearchCacheScope(mentionSearchCacheScope);

    const previousSearch = lastSearchRef.current;
    // The same search sent again: the sections and the highlight on the Retry row stay.
    const isRetry = previousSearch?.key === mentionSearchCacheKey && previousSearch.nonce !== retryNonce;

    lastSearchRef.current = { key: mentionSearchCacheKey, nonce: retryNonce };
    if (!isRetry) setSelection(null);

    const searchMentionsFn = searchMentions;
    const lanes = mentionRequestLanes;
    const cacheKey = mentionSearchCacheKey;
    let cancelled = false;
    let timer: number | undefined;
    const requestId = mentionSearchRequestIdRef.current + 1;
    const cached = getCachedMentionSearch(cacheKey);
    const retryLaterMs = mentionSearchRetryLaterRemainingMs(cacheKey);

    mentionSearchRequestIdRef.current = requestId;

    function isCurrentRequest() {
      return !cancelled && mentionSearchRequestIdRef.current === requestId;
    }

    // Runs when the query changes, the panel closes or it unmounts. Only the typed requests are
    // aborted: bare and refresh requests run to their deadline, so a complete answer still reaches
    // the cache.
    function stopSearch() {
      cancelled = true;
      window.clearTimeout(timer);
      lanes.abort(MENTION_TYPED_LANES);
    }

    // Current on every lane it came from: no newer request replaced it and nothing aborted it. This
    // decides only whether the answer may be cached. Whether it is shown depends on the effect:
    // while the effect is current, only its own rows retry replaces one of its requests, and the
    // fetch leaves that ticket out.
    function isCurrentResult(result: MentionSectionsFetchResult) {
      return result.tickets.every((ticket) => lanes.isCurrent(ticket));
    }

    // Only a complete answer is cached: every request answered, no section failed, and no answer
    // has the superseded shape.
    function cacheCompleteAnswer(result: MentionSectionsFetchResult, stamp: MentionSearchCacheStamp) {
      if (result.cacheable && isCurrentResult(result)) {
        setCachedMentionSections(cacheKey, result.sections, stamp);
      }
    }

    // `stamp` is taken as the requests are sent. A view revoked after it is left out of what they
    // answer, on screen and in the cache.
    function fetchMentionSections({
      refresh,
      stamp,
      onSections,
    }: {
      refresh: boolean;
      stamp: MentionSearchCacheStamp;
      onSections?: (sections: MentionSearchSection[]) => void;
    }) {
      const visible = (sections: MentionSearchSection[]) => withoutRevokedMentionViews(sections, stamp);

      return fetchMentionSearchSections({
        searchMentions: searchMentionsFn,
        requests: mentionSearchRequests,
        cacheKey,
        isCurrent: isCurrentRequest,
        issueTicket: (request) => lanes.issue(mentionRequestLane(request, refresh)),
        onSections: onSections && ((sections) => onSections(visible(sections))),
      }).then((result) => ({ ...result, sections: visible(result.sections) }));
    }

    // Sections that arrive while the rest of the answer is pending. Without items they would only
    // blank what is on screen, such as the previous attempt of a retry, so they are not shown.
    function showInterimSections(sections: MentionSearchSection[]) {
      if (hasMentionItems(sections)) setMentionSections(sections);
    }

    function settle(status: Exclude<MentionSearchStatus, 'busy'>) {
      setSearchStatus(status);
      setBusyUntil(undefined);
      setRetrying(false);
    }

    // The server asked to wait: count down, then send again. The countdown's clock starts with
    // the deadline, so its first paint never shows a second more than is left.
    function sendAfterCooldown(delayMs: number, send: () => void) {
      const now = Date.now();

      setSearchStatus('busy');
      setBusyClock(now);
      setBusyUntil(now + delayMs);
      setRetrying(false);
      window.clearTimeout(timer);
      timer = window.setTimeout(send, delayMs);
    }

    function runSearch() {
      const stamp = mentionSearchCacheStamp();

      void fetchMentionSections({ refresh: false, stamp, onSections: showInterimSections })
        .then((result) => {
          // A bare answer is not aborted by typing, so it is still cached after the query changed.
          cacheCompleteAnswer(result, stamp);
          if (!isCurrentRequest()) return;

          if (result.state === 'complete') {
            setMentionSections(result.sections);
            settle('ok');
            return;
          }

          // Keep what the requests that answered found. Without any, keep what is on screen (the
          // previous attempt of a retry), or a cached answer.
          const fallback = hasMentionItems(result.sections) ? result.sections : getCachedMentionSections(cacheKey);

          if (fallback) setMentionSections(fallback);
          if (result.state === 'busy') sendAfterCooldown(mentionSearchRetryLaterRemainingMs(cacheKey), runSearch);
          else settle(result.state);
        })
        .catch((error) => {
          if (!isCurrentRequest()) return;

          console.error(error);
          settle('unavailable');
        });
    }

    // Revalidates the cached answer on screen, which stays there unless the server answers
    // completely.
    function refreshCachedAnswer() {
      const stamp = mentionSearchCacheStamp();
      const shownCachedAt = getCachedMentionSearch(cacheKey)?.cachedAt;
      // Whether our own refresh callback ran. When a refresh for this key is already in flight,
      // startMentionSearchRefresh joins it without invoking our callback, so we re-read the cache
      // once the shared refresh settles.
      let applied = false;

      void startMentionSearchRefresh(cacheKey, async () => {
        const result = await fetchMentionSections({ refresh: true, stamp });

        cacheCompleteAnswer(result, stamp);
        if (!isCurrentRequest()) return;

        applied = true;
        if (result.state === 'complete') {
          setMentionSections(result.sections);
          settle('ok');
        } else if (result.state === 'busy') {
          sendAfterCooldown(mentionSearchRetryLaterRemainingMs(cacheKey), refreshCachedAnswer);
        } else {
          settle(result.state);
        }
      })
        .then(() => {
          if (applied || !isCurrentRequest()) return;

          const refreshed = getCachedMentionSearch(cacheKey);

          if (refreshed && refreshed.cachedAt !== shownCachedAt) {
            setMentionSections(refreshed.sections);
            settle('ok');
          } else {
            setRetrying(false);
          }
        })
        .catch((error) => {
          console.error(error);
          if (isCurrentRequest()) settle('unavailable');
        });
    }

    if (cached) {
      setMentionSections(cached.sections);
      if (!isRetry) settle('ok');

      // A fresh answer needs no request, unless the user asked to retry.
      if (cached.fresh && !isRetry) return stopSearch;

      if (retryLaterMs > 0) sendAfterCooldown(retryLaterMs, refreshCachedAnswer);
      else refreshCachedAnswer();

      return stopSearch;
    }

    if (!isRetry) setMentionSections([]);

    if (retryLaterMs > 0) {
      sendAfterCooldown(retryLaterMs, runSearch);
    } else {
      // A retry keeps its failure row, which says "Retrying…", until the answer arrives.
      if (!isRetry) settle('loading');
      timer = window.setTimeout(runSearch, isRetry || !hasMentionSearchQuery ? 0 : 120);
    }

    return stopSearch;
  }, [
    hasMentionSearchQuery,
    mentionRequestLanes,
    mentionSearchCacheKey,
    mentionSearchCacheScope,
    mentionSearchRequests,
    open,
    retryNonce,
    searchMentions,
    setSelection,
    useLocalMentionFallback,
  ]);

  // Counts the busy row down to the end of the cooldown, once per second.
  useEffect(() => {
    if (searchStatus !== 'busy' || busyUntil === undefined) return;

    let timer: number | undefined;
    const tick = () => {
      const now = Date.now();
      const remainingMs = busyUntil - now;

      setBusyClock(now);
      if (remainingMs > 0) timer = window.setTimeout(tick, remainingMs % 1000 || 1000);
    };

    tick();
    return () => window.clearTimeout(timer);
  }, [busyUntil, searchStatus]);

  // Offline, the search is sent again as soon as the browser is back online.
  useEffect(() => {
    if (!open || searchStatus !== 'offline') return;

    const handleOnline = () => retrySearch();

    window.addEventListener('online', handleOnline);
    return () => {
      window.removeEventListener('online', handleOnline);
    };
  }, [open, retrySearch, searchStatus]);

  useEffect(() => {
    if (!useLocalMentionFallback || !loadViews) return;

    let cancelled = false;

    setSelection(null);
    setSearchStatus('loading');
    setRetrying(false);

    void loadViews()
      .then((views) => {
        if (cancelled) return;

        setLocalFallbackViews(views ?? []);
        setSearchStatus('ok');
      })
      .catch((error) => {
        if (cancelled) return;

        console.error(error);
        setLocalFallbackViews([]);
        setSearchStatus('unavailable');
      });

    return () => {
      cancelled = true;
    };
  }, [loadViews, retryNonce, setSelection, useLocalMentionFallback]);

  useEffect(() => {
    if (useLocalMentionFallback) return;

    setLocalFallbackViews([]);
  }, [useLocalMentionFallback]);

  useEffect(() => {
    if (!useLocalMentionFallback) return;

    setSelection(null);
  }, [searchText, setSelection, useLocalMentionFallback]);

  const rawMentionSearchResults = useMemo(
    () =>
      flattenMentionSearchSections(pickerMentionSections).filter(
        (result) => hasMentionSearchQuery || result.item.kind !== MentionTargetKind.DatabaseRow
      ),
    [hasMentionSearchQuery, pickerMentionSections]
  );
  const canCreatePageInLocalFallback =
    useLocalMentionFallback && searchStatus !== 'loading' && Boolean(addPage && viewId);
  // Offline is a reason for missing suggestions too, so it offers the same Retry row.
  const showRetryOption = searchStatus === 'unavailable' || searchStatus === 'offline';
  const { mentionResultSections, mentionPanelOptions, retryOption, createPageOptions } = useMemo(() => {
    const resultsBySection = new Map<number, MentionPanelSearchResult[]>();

    rawMentionSearchResults.forEach((result) => {
      const results = resultsBySection.get(result.sectionIndex) ?? [];

      results.push(result);
      resultsBySection.set(result.sectionIndex, results);
    });

    const options: MentionPanelOption[] = [];
    const sections = pickerMentionSections
      .map<MentionPanelResultSection | null>((section, sectionIndex) => {
        const results = resultsBySection.get(sectionIndex) ?? [];

        if (results.length === 0) return null;

        const shouldCollapse =
          section.kind === MentionSearchSectionKind.Pages &&
          !showMorePages &&
          results.length > PAGE_RESULT_COLLAPSE_LIMIT;
        const visibleResults = shouldCollapse ? results.slice(0, PAGE_RESULT_COLLAPSE_LIMIT) : results;
        const sectionOptions: MentionPanelResultOption[] = visibleResults.map((result) => ({
          kind: 'result',
          key: result.key,
          navKey: result.navKey,
          result,
        }));

        if (shouldCollapse) {
          const firstHidden = results[PAGE_RESULT_COLLAPSE_LIMIT];

          sectionOptions.push({
            kind: 'morePages',
            key: `${section.kind}|more`,
            remainingCount: results.length - PAGE_RESULT_COLLAPSE_LIMIT,
            firstHidden: { key: firstHidden.key, navKey: firstHidden.navKey },
          });
        }

        options.push(...sectionOptions);

        return {
          section,
          options: sectionOptions,
        };
      })
      .filter((section): section is MentionPanelResultSection => Boolean(section));
    // After the results and before the create options, so the keyboard reaches it last among them.
    const statusOption: MentionPanelRetryOption | undefined = showRetryOption
      ? { kind: 'retry', key: MENTION_RETRY_OPTION_KEY }
      : undefined;
    const createOptions: MentionPanelCreatePageOption[] = canCreatePageInLocalFallback
      ? [
          {
            kind: 'createPage',
            key: 'createPage:childPage',
            createType: MentionType.childPage,
          },
          {
            kind: 'createPage',
            key: 'createPage:pageReference',
            createType: MentionType.PageRef,
          },
        ]
      : [];

    if (statusOption) options.push(statusOption);
    options.push(...createOptions);

    return {
      mentionResultSections: sections,
      mentionPanelOptions: options,
      retryOption: statusOption,
      createPageOptions: createOptions,
    };
  }, [canCreatePageInLocalFallback, pickerMentionSections, rawMentionSearchResults, showMorePages, showRetryOption]);
  const { mentionOptionByKey, mentionOptionIndexByKey } = useMemo(
    () => ({
      mentionOptionByKey: new Map(mentionPanelOptions.map((option) => [option.key, option])),
      mentionOptionIndexByKey: new Map(mentionPanelOptions.map((option, index) => [option.key, index])),
    }),
    [mentionPanelOptions]
  );

  // Typed rows or a cache refresh can merge in after the user started navigating. Before paint,
  // keep the highlight on the same option, else on the same object in another section, else on
  // the first option, so it never lands on whatever moved into its old position. A Retry row that
  // succeeded leaves no highlight: the user chose Retry, not one of the results it brought.
  useLayoutEffect(() => {
    const current = selectionRef.current;
    const next =
      current?.key === MENTION_RETRY_OPTION_KEY && !mentionOptionByKey.has(current.key)
        ? null
        : reconcileMentionOptionSelection(current, mentionPanelOptions);

    if (next !== current) setSelection(next);
  }, [mentionOptionByKey, mentionPanelOptions, setSelection]);

  // The skeleton stands in for results only while the first answer is pending. A failure, busy or
  // offline row never shows it, and neither does a retry, whose row says "Retrying…".
  const showMentionSearchLoadingState =
    hasMentionPanelSource && searchStatus === 'loading' && rawMentionSearchResults.length === 0;
  const busySeconds = busyUntil === undefined ? 0 : Math.max(0, Math.ceil((busyUntil - busyClock) / 1000));
  const selectedOptionKey = selection?.key;
  const selectedOptionIndex =
    selectedOptionKey === undefined ? undefined : mentionOptionIndexByKey.get(selectedOptionKey);

  useEffect(() => {
    if (selectedOptionIndex === undefined) return;

    const el = ref.current?.querySelector(
      `[data-option-category="${MentionTag.Result}"] [data-option-index="${selectedOptionIndex}"]`
    ) as HTMLButtonElement | null;

    el?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }, [selectedOptionKey, selectedOptionIndex]);

  const handleAddMention = useCallback(
    (mention: Mention) => {
      removeContent();
      closePanel();
      editor.flushLocalChanges();

      Transforms.insertText(editor, '@');

      const newSelection = editor.selection;

      if (!newSelection) {
        console.error('newSelection is undefined');
        return false;
      }

      const start = {
        path: newSelection.anchor.path,
        offset: newSelection.anchor.offset - 1,
      };

      Transforms.select(editor, {
        anchor: start,
        focus: newSelection.focus,
      });
      CustomEditor.addMark(editor, {
        key: EditorMarkFormat.Mention,
        value: mention,
      });

      Transforms.collapse(editor, {
        edge: 'end',
      });

      return true;
    },
    [closePanel, removeContent, editor]
  );

  const handleAddPage = useCallback(
    async (type: MentionType.childPage | MentionType.PageRef = MentionType.PageRef) => {
      if (!addPage || !viewId) return;

      try {
        const response = await addPage(viewId, { name: searchText, layout: ViewLayout.Document });

        if (handleAddMention({ page_id: response.view_id, type })) {
          openPageModal?.(response.view_id);
        }
      } catch (error) {
        console.error(error);
      }
    },
    [addPage, handleAddMention, openPageModal, searchText, viewId]
  );

  const notifyPersonMention = useNotifyPersonMention();
  const [sendNotification, setSendNotification] = useSendMentionNotification();

  const handleSelectedSearchResult = useCallback(
    (result: MentionPanelSearchResult) => {
      const selectedBlockId = getSelectedBlockId(editor);
      const mention =
        result.mention.type === MentionType.Person
          ? {
              ...result.mention,
              page_id: result.mention.page_id || mentionContext?.view_id || viewId,
              block_id: result.mention.block_id || selectedBlockId,
              row_id: result.mention.row_id || mentionContext?.row_id,
            }
          : result.mention;

      if (handleAddMention(mention) && mention.type === MentionType.Person && mention.person_id) {
        if (onPersonPicked) onPersonPicked(mention.person_id, sendNotification);
        else if (notifyOnInsert) void notifyPersonMention(mention, sendNotification);
      }
    },
    [
      editor,
      handleAddMention,
      mentionContext?.row_id,
      mentionContext?.view_id,
      notifyOnInsert,
      notifyPersonMention,
      onPersonPicked,
      sendNotification,
      viewId,
    ]
  );

  const expandMorePages = useCallback(
    (option: MentionPanelMorePagesOption) => {
      setShowMorePages(true);
      // Expanding from the highlighted row hands the highlight to the first item it reveals.
      if (selectionRef.current?.key === option.key) setSelection(option.firstHidden);
    },
    [setSelection]
  );

  const handlePanelKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // This native listener runs before the host editor's React handler.
      // Let the IME confirm text without selecting a result or cancelling it.
      if (e.isComposing) return;

      const { key } = e;

      switch (key) {
        case 'Enter': {
          e.preventDefault();
          // Resolve by key: after a merge, the option at the highlight's old position is another item.
          const current = selectionRef.current;
          const option = current ? mentionOptionByKey.get(current.key) : undefined;

          if (option?.kind === 'result') {
            handleSelectedSearchResult(option.result);
          } else if (option?.kind === 'morePages') {
            expandMorePages(option);
          } else if (option?.kind === 'retry') {
            // A pending retry ignores Enter, so pressing it twice never sends twice.
            if (!retrying) retrySearch();
          } else if (option?.kind === 'createPage') {
            void handleAddPage(option.createType);
          }

          break;
        }

        case 'Escape':
          e.stopPropagation();
          e.preventDefault();
          closePanel();
          break;
        case 'ArrowUp':
        case 'ArrowDown': {
          e.stopPropagation();
          e.preventDefault();
          const optionCount = mentionPanelOptions.length;

          if (optionCount === 0) break;

          const current = selectionRef.current;
          const currentIndex = current ? mentionOptionIndexByKey.get(current.key) : undefined;
          let nextIndex: number;

          if (currentIndex === undefined) {
            nextIndex = key === 'ArrowDown' ? 0 : optionCount - 1;
          } else {
            nextIndex =
              key === 'ArrowDown' ? (currentIndex + 1) % optionCount : (currentIndex - 1 + optionCount) % optionCount;
          }

          setSelection(mentionOptionSelection(mentionPanelOptions[nextIndex]));
          break;
        }

        default:
          break;
      }
    },
    [
      closePanel,
      expandMorePages,
      handleAddPage,
      handleSelectedSearchResult,
      mentionOptionByKey,
      mentionOptionIndexByKey,
      mentionPanelOptions,
      retrySearch,
      retrying,
      setSelection,
    ]
  );
  const handlePanelKeyDownRef = useRef(handlePanelKeyDown);

  // Refresh before paint, so a key pressed right after new options render acts on those options.
  useLayoutEffect(() => {
    handlePanelKeyDownRef.current = handlePanelKeyDown;
  }, [handlePanelKeyDown]);

  useEffect(() => {
    if (!open) return;

    const slateDom = ReactEditor.toDOMNode(editor, editor);
    const handleKeyDown = (e: KeyboardEvent) => handlePanelKeyDownRef.current(e);

    slateDom.addEventListener('keydown', handleKeyDown);

    return () => {
      slateDom.removeEventListener('keydown', handleKeyDown);
    };
  }, [editor, open]);
  const [transformOrigin, setTransformOrigin] = useState<PopoverOrigin | undefined>(undefined);

  useEffect(() => {
    if (open && panelPosition) {
      const origins = calculateOptimalOrigins(panelPosition, 320, 560, undefined, 16);
      const isAlignBottom = origins.transformOrigin.vertical === 'bottom';

      setTransformOrigin(
        isAlignBottom
          ? origins.transformOrigin
          : {
              vertical: -30,
              horizontal: origins.transformOrigin.horizontal,
            }
      );
    }
  }, [open, panelPosition]);

  return (
    <Popover
      adjustOrigins={false}
      data-testid={'mention-panel'}
      open={open}
      onClose={closePanel}
      anchorReference={'anchorPosition'}
      anchorPosition={panelPosition}
      disableAutoFocus={true}
      disableRestoreFocus={true}
      disableEnforceFocus={true}
      transformOrigin={transformOrigin}
      PaperProps={{
        sx: {
          border: '1px solid var(--border-primary)',
          backgroundColor: 'var(--surface-primary)',
          boxShadow: '0px 4px 32px rgba(0, 0, 0, 0.48) !important',
        },
      }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div
        ref={ref}
        className={
          'appflowy-scroller relative flex max-h-[560px] w-[400px] flex-col overflow-y-auto bg-surface-primary py-1'
        }
        aria-busy={showMentionSearchLoadingState}
      >
        {hasMentionPanelSource && (
          <div data-option-category={MentionTag.Result} className={'flex flex-col'}>
            {showMentionSearchLoadingState ? (
              <MentionPanelLoadingState />
            ) : (
              mentionResultSections.map(({ section, options }, sectionResultIndex) => (
                <div
                  key={`${section.kind}:${section.title}`}
                  data-section-kind={section.kind}
                  className={'flex flex-col px-2 py-1'}
                >
                  {sectionResultIndex > 0 && <Divider className={'-mx-2 mb-1 border-border-primary'} />}
                  <MentionSectionTitle
                    section={section}
                    trailing={
                      options.some(
                        (option) => option.kind === 'result' && option.result.mention.type === MentionType.Person
                      ) ? (
                        <label className='ml-auto flex items-center gap-2 text-xs font-normal'>
                          {t('document.mentionMenu.sendNotification', 'Send notification')}
                          <Switch
                            checked={sendNotification}
                            onCheckedChange={setSendNotification}
                            aria-label={t('document.mentionMenu.sendNotification', 'Send notification')}
                            tabIndex={-1}
                            onMouseDown={(event) => event.preventDefault()}
                          />
                        </label>
                      ) : undefined
                    }
                  />
                  {options.map((option) => {
                    const index = mentionOptionIndexByKey.get(option.key) ?? 0;
                    const selected = selectedOptionKey === option.key;

                    if (option.kind === 'morePages') {
                      return (
                        <MentionMoreResultsButton
                          key={option.key}
                          optionKey={option.key}
                          remainingCount={option.remainingCount}
                          index={index}
                          selected={selected}
                          onClick={() => expandMorePages(option)}
                        />
                      );
                    }

                    return (
                      <MentionResultButton
                        key={option.key}
                        optionKey={option.key}
                        result={option.result}
                        index={index}
                        selected={selected}
                        onClick={() => handleSelectedSearchResult(option.result)}
                      />
                    );
                  })}
                </div>
              ))
            )}
            {(retryOption || searchStatus === 'busy') && (
              <div className={'flex flex-col px-2 py-1'}>
                {mentionResultSections.length > 0 && <Divider className={'-mx-2 mb-1 border-border-primary'} />}
                {retryOption ? (
                  <MentionRetryButton
                    offline={searchStatus === 'offline'}
                    retrying={retrying}
                    optionKey={retryOption.key}
                    index={mentionOptionIndexByKey.get(retryOption.key) ?? 0}
                    selected={selectedOptionKey === retryOption.key}
                    onClick={() => {
                      if (!retrying) retrySearch();
                    }}
                  />
                ) : (
                  <MentionBusyRow seconds={busySeconds} />
                )}
              </div>
            )}
            {/* Only an answer that came back complete can say that nothing matched. */}
            {searchStatus === 'ok' &&
              rawMentionSearchResults.length === 0 &&
              createPageOptions.length === 0 &&
              (searchText || useLocalMentionFallback) && (
                <div className={'flex items-center justify-center p-2 text-sm text-text-secondary'}>
                  {t('findAndReplace.noResult')}
                </div>
              )}
            {createPageOptions.length > 0 && (
              <div className={'flex flex-col px-2 py-1'}>
                {(mentionResultSections.length > 0 || retryOption || searchStatus === 'busy') && (
                  <Divider className={'-mx-2 mb-1 border-border-primary'} />
                )}
                {createPageOptions.map((option) => {
                  const index = mentionOptionIndexByKey.get(option.key) ?? 0;

                  return (
                    <MentionCreatePageButton
                      key={option.key}
                      optionKey={option.key}
                      createType={option.createType}
                      searchText={searchText}
                      index={index}
                      selected={selectedOptionKey === option.key}
                      onClick={() => void handleAddPage(option.createType)}
                    />
                  );
                })}
              </div>
            )}
          </div>
        )}
      </div>
    </Popover>
  );
}

export default MentionPanel;
