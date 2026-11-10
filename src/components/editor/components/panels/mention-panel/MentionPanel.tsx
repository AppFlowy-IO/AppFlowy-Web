import { Button, Divider, LinearProgress } from '@mui/material';
import { PopoverOrigin } from '@mui/material/Popover/Popover';
import dayjs from 'dayjs';
import {
  ReactNode,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import { useTranslation } from 'react-i18next';
import { Editor as SlateEditor, Element as SlateElement, Transforms } from 'slate';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { APP_EVENTS } from '@/application/constants';
import type { MentionSessionSource } from '@/application/services/js-services/http/mention-presentation-metrics';
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
import {
  loadMentionPickMemory,
  MentionPickScore,
  mentionPickMemoryStorageKey,
  readMentionPickMemoryEnabled,
  recordMentionPick,
} from './mentionPickMemory';
import { mentionLocalPickItem, mentionLocalPickUnderAnyView, rankMentionSectionsByPicks } from './mentionPickRanking';
import {
  buildMentionProvisionalSections,
  capMentionSections,
  longestCachedMentionPrefix,
  mentionAnswerMissingKinds,
  mentionInterimMissingKinds,
  withoutMentionKeys,
  withProvisionalItems,
} from './mentionProvisional';
import { mentionRequestLane, MentionRequestLanes } from './mentionRequestLanes';
import {
  ensureMentionSearchCacheScope,
  getCachedMentionSearch,
  getCachedMentionSections,
  getMentionSearchCacheView,
  getRevokedMentionViews,
  mentionItemShowsAnyView,
  mentionSearchCacheStamp,
  MentionSearchCacheStamp,
  mentionSearchRetryLaterRemainingMs,
  setCachedMentionSections,
  startMentionSearchRefresh,
  subscribeMentionSearchCache,
  subscribeMentionSearchCacheInvalidation,
  subscribeRevokedMentionViews,
  withoutMentionView,
  withoutRevokedMentionViews,
} from './mentionSearchCache';
import { fetchMentionSearchSections, MentionSectionsFetchResult } from './mentionSearchFetch';
import {
  createMentionSearchScheduler,
  MentionFlightWatcher,
  MentionScheduledSearch,
  MentionSearchFlight,
  readMentionSchedulerSettings,
} from './mentionSearchScheduler';
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
import { MENTION_TYPEAHEAD_LEGACY, readMentionTypeaheadSettings } from './mentionTypeaheadFlag';
import { useMentionLocalSnapshot } from './useMentionLocalSnapshot';
import { useMentionPickerSession } from './useMentionPickerSession';
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

/** Where the search's sections on screen came from: a server answer, or a cached one. */
type MentionSectionsSource = Extract<MentionSessionSource, 'server' | 'cache'>;

/** The answer the sections on screen show: the cache key of its search, and where it came from. */
interface MentionSectionsAnswer {
  key: string;
  source: MentionSectionsSource;
  /**
   * The kinds the answer lacks while a request of it is pending, or because one failed. Only the
   * picker's `mentionTypeaheadV2` reads it: provisional items of those kinds stay on screen.
   */
  missingKinds?: ReadonlySet<MentionTargetKind>;
}

const NO_REVOKED_VIEWS: ReadonlySet<string> = new Set();

function noRevokedViews() {
  return NO_REVOKED_VIEWS;
}

function noCacheSubscription() {
  return () => undefined;
}

const NO_MENTION_SECTIONS: MentionSearchSection[] = [];
const NO_MISSING_KINDS: ReadonlySet<MentionTargetKind> = new Set();
const NO_NAV_KEYS: ReadonlySet<string> = new Set();
const NO_PICK_SCORES: ReadonlyMap<string, MentionPickScore> = new Map();

/**
 * The sections of a typed answer that the picker's `mentionTypeaheadV2` ranks by the typeahead
 * contract's client ranking, so a body-only hit never sits above a title match, whatever server
 * answered (MEN-WEB-08). Databases keep the server's order unless pick memory scores one: Search
 * also tiers a database by the name of the view that reached it, which the item does not carry,
 * so the client would put a database found by its view name below every title match.
 */
const MENTION_V2_RETIER_KINDS: ReadonlySet<MentionSearchSectionKind> = new Set([
  MentionSearchSectionKind.People,
  MentionSearchSectionKind.Pages,
  MentionSearchSectionKind.DatabaseRows,
]);

/** What the picker's `mentionTypeaheadV2` shows for the query typed now. */
interface MentionV2View {
  sections: MentionSearchSection[];
  /** Provisional sections, narrowed from earlier answers, while the answer to the query is pending. */
  provisional: boolean;
  /** Where the sections came from, as a session report gives it. */
  source?: MentionSessionSource;
  /** Navigation keys of the picked targets that joined from the local index (MEN-WEB-10). */
  localKeys?: ReadonlySet<string>;
  /** Navigation keys of the provisional items an incomplete answer keeps. */
  carriedKeys?: ReadonlySet<string>;
}

/** One search's requests in flight, as the panel hands them to its scheduler. */
type MentionPanelFlight = MentionSearchFlight<MentionSectionsFetchResult, MentionSearchSection[]>;

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

/**
 * A thin bar at the top of the list while the answer to what is typed now is pending over results
 * already shown (MEN-WEB-08), so the list is never replaced by the skeleton.
 */
function MentionPanelProgressBar() {
  const { t } = useTranslation();

  return (
    <div className={'pointer-events-none sticky top-0 z-10 -mb-0.5 h-0.5 w-full'}>
      <LinearProgress
        aria-label={t('document.mention.updatingSuggestions')}
        data-testid={'mention-progress'}
        sx={{ height: 2 }}
      />
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
  const {
    isPanelOpen,
    panelPosition,
    closePanel,
    searchText,
    removeContent,
    activePanel,
    activeTrigger,
    panelOpenedAt,
  } = usePanelContext();
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
  // Set with the sections, unset while they show no answer: pick memory orders only the answer to
  // the search on screen, and a session report gives where a pick came from.
  const [mentionSectionsAnswer, setMentionSectionsAnswer] = useState<MentionSectionsAnswer | undefined>(undefined);
  const mentionSectionsSource = mentionSectionsAnswer?.source;
  // The search key of the answer last shown, while that answer lists items. It is set as the answer
  // is shown, before React renders it: the picker's v2 never replaces an earlier attempt's items for
  // the same query with an incomplete answer that lists none.
  const shownItemsKeyRef = useRef<string | undefined>(undefined);
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
  // And with its own scheduler, which decides when the session's searches are sent (MEN-WEB-05).
  const mentionSearchScheduler = useMemo(
    () => (open ? createMentionSearchScheduler<MentionPanelFlight>(readMentionSchedulerSettings()) : null),
    [open]
  );
  const hasSearchMentions = Boolean(searchMentions);
  // Keep-and-narrow first paint (MEN-WEB-08), off by default and read once per opening: a keystroke
  // keeps the list, narrowed at once to what still matches, until the server answers.
  const typeaheadSettings = useMemo(() => (open ? readMentionTypeaheadSettings() : MENTION_TYPEAHEAD_LEGACY), [open]);
  const typeaheadV2 = typeaheadSettings.v2 && hasSearchMentions;
  // The first option is highlighted unless an arrow key holds the highlight (off by default).
  const defaultHighlight = typeaheadV2 && typeaheadSettings.defaultHighlight;
  // The query an arrow key took the highlight at: it stays on its item until the next keystroke.
  const selectionLockRef = useRef<string | undefined>(undefined);
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
  // Pick memory (MEN-WEB-10), off by default: what this user inserted after typing what, read from
  // the device once per opening. It orders the answer to a typed search once that answer is on
  // screen (a pending one shows the loading state as before), and brings a picked target the
  // answer lacks from the local index.
  const pickMemoryKey = useMemo(
    () => mentionPickMemoryStorageKey(workspaceId, currentUser?.uid),
    [currentUser?.uid, workspaceId]
  );
  const pickMemory = useMemo(
    () =>
      open && hasSearchMentions && pickMemoryKey && readMentionPickMemoryEnabled()
        ? loadMentionPickMemory(pickMemoryKey)
        : undefined,
    [hasSearchMentions, open, pickMemoryKey]
  );
  const pickLocalSnapshot = useMentionLocalSnapshot(pickMemory ? workspaceId : undefined);
  // The views the user lost access to in this session. The local index lists one, and the pages
  // below it, until its sources catch up, so a picked one never joins from it, and an earlier
  // answer may list one, so a provisional list never shows it.
  const getRevokedViews = pickMemory || typeaheadV2 ? getRevokedMentionViews : noRevokedViews;
  const revokedViews = useSyncExternalStore(subscribeRevokedMentionViews, getRevokedViews, getRevokedViews);
  const pagesSectionTitle = t('document.mention.pagesSection');
  // The picker shows databases inside Pages, or as Pages when no page is listed
  // (normalizeMentionSearchSectionsForPicker), so a created Databases section is titled Pages.
  const mentionSectionTitle = useCallback(
    (kind: MentionSearchSectionKind) => {
      if (kind === MentionSearchSectionKind.People) return t('document.mention.peopleSection');
      if (kind === MentionSearchSectionKind.Dates) return t('inlineActions.date');
      return pagesSectionTitle;
    },
    [pagesSectionTitle, t]
  );
  // A view the user lost access to never joins, nor does one below it: the app names only the view
  // whose share changed, and the index lists the pages below it until its sources catch up.
  const pickLocalItem = useCallback(
    (key: string) => {
      const item = mentionLocalPickItem(pickLocalSnapshot, key);
      const revoked =
        item !== undefined &&
        (mentionItemShowsAnyView(item, revokedViews) ||
          mentionLocalPickUnderAnyView(pickLocalSnapshot, key, revokedViews));

      return revoked ? undefined : item;
    },
    [pickLocalSnapshot, revokedViews]
  );
  // Whether the sections on screen answer the search for what is typed now, not one before it.
  const showsCurrentAnswer = mentionSectionsAnswer?.key === mentionSearchCacheKey;
  const sectionsByPicks = useMemo(() => {
    const sections = useLocalMentionFallback ? localFallbackMentionSections : mentionSections;

    // The picker's v2 ranks its answers itself (mentionV2View below).
    if (!pickMemory || typeaheadV2 || useLocalMentionFallback || !hasMentionSearchQuery || !showsCurrentAnswer) {
      return { sections, localKeys: undefined };
    }

    const query = searchText ?? '';
    const nowMs = Date.now();

    return rankMentionSectionsByPicks({
      query,
      sections,
      scores: pickMemory.scores(query, nowMs),
      request: { include: mentionInclude },
      requesterPersonId: currentUser?.uuid,
      localItem: pickLocalItem,
      sectionTitle: mentionSectionTitle,
      nowMs,
    });
  }, [
    currentUser?.uuid,
    hasMentionSearchQuery,
    localFallbackMentionSections,
    mentionInclude,
    mentionSections,
    mentionSectionTitle,
    pickLocalItem,
    pickMemory,
    searchText,
    showsCurrentAnswer,
    typeaheadV2,
    useLocalMentionFallback,
  ]);
  // MEN-WEB-08 below, all of it only with the picker's v2 on. The cached answers as this render
  // reads them: a late answer, such as a bare one that arrives after typing, feeds the list at once.
  const mentionCacheView = useSyncExternalStore(
    typeaheadV2 ? subscribeMentionSearchCache : noCacheSubscription,
    getMentionSearchCacheView,
    getMentionSearchCacheView
  );
  // What the list showed at the last commit, the first source of a keystroke's provisional sections.
  const shownSectionsRef = useRef<MentionSearchSection[]>(NO_MENTION_SECTIONS);
  const v2PickScores = useMemo(
    () =>
      typeaheadV2 && pickMemory && hasMentionSearchQuery
        ? pickMemory.scores(searchText ?? '', Date.now())
        : NO_PICK_SCORES,
    [hasMentionSearchQuery, pickMemory, searchText, typeaheadV2]
  );
  // Ranks a typed answer, or provisional sections, as the picker's v2 shows them: People, Pages and
  // rows by the contract's client ranking, with pick memory's signals when it is on.
  const rankV2Sections = useCallback(
    (sections: MentionSearchSection[], localItem?: (key: string) => MentionSearchResultItem | undefined) =>
      rankMentionSectionsByPicks({
        query: searchText ?? '',
        sections,
        scores: v2PickScores,
        request: { include: mentionInclude },
        requesterPersonId: currentUser?.uuid,
        localItem,
        sectionTitle: mentionSectionTitle,
        nowMs: Date.now(),
        retierKinds: MENTION_V2_RETIER_KINDS,
      }),
    [currentUser?.uuid, mentionInclude, mentionSectionTitle, searchText, v2PickScores]
  );
  const bareMentionSearchCacheKey = useMemo(
    () =>
      buildMentionSearchRequestsCacheKey(buildMentionSearchRequests({ ...mentionSearchRequest, query: '' }), {
        workspaceId,
        userId: currentUser?.uuid,
      }),
    [currentUser?.uuid, mentionSearchRequest, workspaceId]
  );
  // A typed query's provisional sections: what still matches it in the list on screen, the cached
  // answer of its longest typed prefix and the cached bare answer, ranked as an answer is. Date and
  // reminder quick picks come from the newer of the two cached answers, never from the screen.
  const provisionalMentionSections = useMemo(() => {
    if (!typeaheadV2 || !hasMentionSearchQuery) return NO_MENTION_SECTIONS;

    const query = searchText ?? '';
    const prefixKey = (prefix: string) =>
      prefix.trim()
        ? buildMentionSearchRequestsCacheKey(buildMentionSearchRequests({ ...mentionSearchRequest, query: prefix }), {
            workspaceId,
            userId: currentUser?.uuid,
          })
        : undefined;
    const prefix = longestCachedMentionPrefix(query, prefixKey, mentionCacheView.answer);
    const bare = mentionCacheView.answer(bareMentionSearchCacheKey);
    const narrowed = buildMentionProvisionalSections({
      query,
      sources: [shownSectionsRef.current, prefix?.sections, bare?.sections],
      quickPickSources: [prefix, bare],
      include: mentionInclude,
      hides: (item) => mentionItemShowsAnyView(item, revokedViews),
      sectionTitle: mentionSectionTitle,
    });

    return capMentionSections(rankV2Sections(narrowed).sections, MENTION_SEARCH_LIMIT);
  }, [
    bareMentionSearchCacheKey,
    currentUser?.uuid,
    hasMentionSearchQuery,
    mentionCacheView,
    mentionInclude,
    mentionSearchRequest,
    mentionSectionTitle,
    rankV2Sections,
    revokedViews,
    searchText,
    typeaheadV2,
    workspaceId,
  ]);
  const mentionV2View = useMemo((): MentionV2View | undefined => {
    if (!typeaheadV2) return undefined;

    // The answer to what is typed now: on screen, or cached, which the search shows this commit.
    const cachedNow = showsCurrentAnswer ? undefined : mentionCacheView.sections(mentionSearchCacheKey);
    const answer = showsCurrentAnswer ? mentionSections : cachedNow;
    const source = showsCurrentAnswer ? mentionSectionsSource : cachedNow && 'cache';

    // A bare `@` narrows nothing: it shows its answer, or the skeleton while that is pending.
    if (!hasMentionSearchQuery) return { sections: answer ?? NO_MENTION_SECTIONS, provisional: false, source };
    if (!answer) return { sections: provisionalMentionSections, provisional: true, source: 'cache' };

    // Provisional items of the kinds a pending or failed request did not answer stay.
    const missingKinds = (showsCurrentAnswer && mentionSectionsAnswer?.missingKinds) || NO_MISSING_KINDS;
    const { sections, carriedKeys } = withProvisionalItems(answer, provisionalMentionSections, missingKinds);
    const ranked = rankV2Sections(sections, pickMemory ? pickLocalItem : undefined);

    return { sections: ranked.sections, provisional: false, source, localKeys: ranked.localKeys, carriedKeys };
  }, [
    hasMentionSearchQuery,
    mentionCacheView,
    mentionSearchCacheKey,
    mentionSections,
    mentionSectionsAnswer?.missingKinds,
    mentionSectionsSource,
    pickLocalItem,
    pickMemory,
    provisionalMentionSections,
    rankV2Sections,
    showsCurrentAnswer,
    typeaheadV2,
  ]);
  const sourceMentionSections = mentionV2View ? mentionV2View.sections : sectionsByPicks.sections;
  // The picked targets the local index added, which a session report counts as the local lane's.
  const pickLocalKeys = mentionV2View ? mentionV2View.localKeys : sectionsByPicks.localKeys;

  // After each commit, remember what the list shows for the next keystroke, without the picked
  // targets the local index added: those join only an answer to what is typed (MEN-WEB-10).
  useLayoutEffect(() => {
    shownSectionsRef.current = mentionV2View
      ? withoutMentionKeys(mentionV2View.sections, mentionV2View.localKeys ?? NO_NAV_KEYS)
      : NO_MENTION_SECTIONS;
  }, [mentionV2View]);
  const pickerMentionSections = useMemo(
    () =>
      normalizeMentionSearchSectionsForPicker(
        enableReminderMentions === false
          ? sourceMentionSections.map((section) => ({
              ...section,
              items: section.items.filter((item) => item.kind !== MentionTargetKind.Reminder),
            }))
          : sourceMentionSections,
        pagesSectionTitle
      ),
    [sourceMentionSections, enableReminderMentions, pagesSectionTitle]
  );

  useEffect(() => {
    if (!open) {
      setSelection(null);
      setShowMorePages(false);
      selectionLockRef.current = undefined;
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

  // Closing the panel or unmounting it drops the search waiting to be sent and aborts the typed
  // search in flight. The bare request and refreshes run to their deadline, so their complete
  // answers still reach the cache.
  useEffect(() => () => mentionSearchScheduler?.close(), [mentionSearchScheduler]);

  useEffect(() => {
    if (!open || !searchMentions || !mentionRequestLanes || !mentionSearchScheduler) {
      if (useLocalMentionFallback) return;

      shownItemsKeyRef.current = undefined;
      setMentionSections([]);
      setMentionSectionsAnswer(undefined);
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
    // A keystroke ends the navigation, as before. With the default highlight on, the highlight
    // moves to the first option instead (the selection reconciler below).
    if (!isRetry && !defaultHighlight) setSelection(null);

    const searchMentionsFn = searchMentions;
    const lanes = mentionRequestLanes;
    const scheduler = mentionSearchScheduler;
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
    // answer, on screen and in the cache. The flight serves every search that asks the same, so it
    // goes on (its rows retry, its early sections) while one of them is the panel's.
    function fetchMentionSections({
      flight,
      refresh,
      stamp,
    }: {
      flight: MentionPanelFlight;
      refresh: boolean;
      stamp: MentionSearchCacheStamp;
    }) {
      const visible = (sections: MentionSearchSection[]) => withoutRevokedMentionViews(sections, stamp);

      return fetchMentionSearchSections({
        searchMentions: searchMentionsFn,
        requests: mentionSearchRequests,
        cacheKey,
        isCurrent: () => flight.wanted(),
        issueTicket: (request) => flight.track(lanes.issue(mentionRequestLane(request, refresh))),
        onSections: refresh ? undefined : (sections) => flight.showInterim(visible(sections)),
      }).then((result) => ({ ...result, sections: visible(result.sections) }));
    }

    // Shows `sections`, the answer to this search from `source`, or no answer without one.
    // `missingKinds` are the kinds a pending or failed request did not answer (the picker's v2).
    function showSections(
      sections: MentionSearchSection[],
      source?: MentionSectionsSource,
      missingKinds?: ReadonlySet<MentionTargetKind>
    ) {
      shownItemsKeyRef.current = source && hasMentionItems(sections) ? cacheKey : undefined;
      setMentionSections(sections);
      setMentionSectionsAnswer((shown) => {
        if (!source) return undefined;
        return shown?.key === cacheKey && shown.source === source && shown.missingKinds === missingKinds
          ? shown
          : { key: cacheKey, source, missingKinds };
      });
    }

    // Sections that arrive while the rest of the answer is pending. Without items they would only
    // blank what is on screen, such as the previous attempt of a retry, so they are not shown.
    function showInterimSections(sections: MentionSearchSection[]) {
      if (hasMentionItems(sections)) {
        showSections(sections, 'server', typeaheadV2 ? mentionInterimMissingKinds(sections) : undefined);
      }
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

    // Shows a search's answer: its own, or that of the flight it joined.
    function showSearchAnswer(result: MentionSectionsFetchResult) {
      if (!isCurrentRequest()) return;

      if (result.state === 'complete') {
        showSections(result.sections, 'server');
        settle('ok');
        return;
      }

      // Keep what the requests that answered found. Without any, show a cached answer, or keep what
      // is on screen (the previous attempt of a retry). The picker's v2 shows an answer without
      // items too when a request of it answered, unless an attempt for this query showed items, so
      // of its provisional list only the kinds that the answer lacks stay. When none answered, every
      // kind is missing and the provisional list stays as it is.
      if (hasMentionItems(result.sections)) {
        showSections(result.sections, 'server', typeaheadV2 ? mentionAnswerMissingKinds(result.outcomes) : undefined);
      } else {
        const cachedSections = getCachedMentionSections(cacheKey);

        if (cachedSections) {
          showSections(cachedSections, 'cache');
        } else if (
          typeaheadV2 &&
          shownItemsKeyRef.current !== cacheKey &&
          result.outcomes.some(({ status }) => status === 'ok')
        ) {
          showSections(result.sections, 'server', mentionAnswerMissingKinds(result.outcomes));
        }
      }

      if (result.state === 'busy') sendAfterCooldown(mentionSearchRetryLaterRemainingMs(cacheKey), resubmit);
      else settle(result.state);
    }

    function showSearchFailure(error: unknown) {
      if (!isCurrentRequest()) return;

      console.error(error);
      settle('unavailable');
    }

    // The cached answer on screen stays there unless the refresh answers completely.
    function showRefreshAnswer(result: MentionSectionsFetchResult) {
      if (!isCurrentRequest()) return;

      if (result.state === 'complete') {
        showSections(result.sections, 'server');
        settle('ok');
      } else if (result.state === 'busy') {
        sendAfterCooldown(mentionSearchRetryLaterRemainingMs(cacheKey), resubmit);
      } else {
        settle(result.state);
      }
    }

    function showRefreshFailure(error: unknown) {
      console.error(error);
      if (isCurrentRequest()) settle('unavailable');
    }

    const watcher: MentionFlightWatcher<MentionSearchSection[]> = {
      isCurrent: isCurrentRequest,
      showInterim: showInterimSections,
    };

    function startSearch(): MentionPanelFlight {
      const flight: MentionPanelFlight = new MentionSearchFlight({
        outlivesPicker: !hasMentionSearchQuery,
        watcher,
        run: async (current) => {
          const stamp = mentionSearchCacheStamp();
          const result = await fetchMentionSections({ flight: current, refresh: false, stamp });

          // A bare answer is not aborted by typing, so it is still cached after the query changed.
          // Neither is an older typed group under the contract scheduler.
          cacheCompleteAnswer(result, stamp);
          return result;
        },
      });

      void flight.result.then(showSearchAnswer).catch(showSearchFailure);
      return flight;
    }

    // Revalidates the cached answer on screen. A refresh of the key still in flight, such as one an
    // earlier opening of the panel sent, is joined instead of sent again, and its answer counts as
    // this panel's own: its results, Retry row, busy countdown or offline row show here.
    function startRefresh(): MentionPanelFlight {
      const flight: MentionPanelFlight = new MentionSearchFlight({
        outlivesPicker: true,
        watcher,
        run: (current) =>
          startMentionSearchRefresh(cacheKey, async () => {
            const stamp = mentionSearchCacheStamp();
            const result = await fetchMentionSections({ flight: current, refresh: true, stamp });

            cacheCompleteAnswer(result, stamp);
            return result;
          }),
      });

      void flight.result.then(showRefreshAnswer).catch(showRefreshFailure);
      return flight;
    }

    // What this query needs sent. The scheduler sends it when the session's rules allow, or hands
    // it the flight in progress that already asks the same.
    const search: MentionScheduledSearch<MentionPanelFlight> = {
      key: cacheKey,
      bare: !hasMentionSearchQuery,
      refresh: Boolean(cached),
      send: () => {
        if (!isCurrentRequest()) return null;

        // An answer may have arrived while the search waited, such as that of the group before it.
        const current = getCachedMentionSearch(cacheKey);

        if (current?.fresh && !isRetry) {
          showSections(current.sections, 'cache');
          settle('ok');
          return null;
        }

        return current ? startRefresh() : startSearch();
      },
      join: (flight) => {
        flight.watch(watcher);
        if (cached) void flight.result.then(showRefreshAnswer).catch(showRefreshFailure);
        else void flight.result.then(showSearchAnswer).catch(showSearchFailure);
      },
    };

    // Sends the search again: after a server cooldown, without waiting for typing to pause.
    function resubmit() {
      scheduler.resubmit(search);
    }

    // A keystroke hands the search to the scheduler; a retry sends it again at once.
    function submit() {
      if (isRetry) scheduler.resubmit(search);
      else scheduler.input(search);
    }

    // The server asked to wait for this query: count down, then send it. A keystroke that came
    // back to it still counts for the scheduler.
    function submitAfterCooldown() {
      if (!isRetry) scheduler.input(null);
      sendAfterCooldown(retryLaterMs, resubmit);
    }

    // Runs when the query changes, the panel closes or it unmounts. The scheduler decides what
    // happens to the requests already sent (see mentionSearchScheduler.ts).
    function stopSearch() {
      cancelled = true;
      window.clearTimeout(timer);
      scheduler.withdraw(search);
    }

    // A one-letter query that the session keeps local sends nothing, and what is on screen stays
    // until the local lane (MEN-WEB-09) renders such queries.
    if (hasMentionSearchQuery && scheduler.keepsLocal(searchText ?? '')) {
      scheduler.input(null);
      if (cached) showSections(cached.sections, 'cache');
      settle('ok');
      return stopSearch;
    }

    if (cached) {
      showSections(cached.sections, 'cache');
      if (!isRetry) settle('ok');

      // A fresh answer needs no request, unless the user asked to retry.
      if (cached.fresh && !isRetry) scheduler.input(null);
      else if (retryLaterMs > 0) submitAfterCooldown();
      else submit();

      return stopSearch;
    }

    // The picker's v2 keeps the list on screen: it shows provisional sections until the answer.
    if (!isRetry && !typeaheadV2) showSections([]);

    if (retryLaterMs > 0) {
      submitAfterCooldown();
    } else {
      // A retry keeps its failure row, which says "Retrying…", until the answer arrives.
      if (!isRetry) settle('loading');
      submit();
    }

    return stopSearch;
  }, [
    defaultHighlight,
    hasMentionSearchQuery,
    mentionRequestLanes,
    mentionSearchCacheKey,
    mentionSearchCacheScope,
    mentionSearchRequests,
    mentionSearchScheduler,
    open,
    retryNonce,
    searchMentions,
    searchText,
    setSelection,
    typeaheadV2,
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
  const { mentionResultSections, mentionPanelOptions, retryOption, createPageOptions, resultRanks } = useMemo(() => {
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

    // The 1-based display position of each result on screen, across sections, as a session report
    // ranks a pick. "N more", Retry and "Create" rows hold no position.
    const ranks = new Map<string, number>();

    options.forEach((option) => {
      if (option.kind === 'result') ranks.set(option.key, ranks.size + 1);
    });

    return {
      mentionResultSections: sections,
      mentionPanelOptions: options,
      retryOption: statusOption,
      createPageOptions: createOptions,
      resultRanks: ranks,
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
  //
  // With the default highlight on (MEN-WEB-08), the highlight is the first result and follows the
  // top of the list as it is narrowed and answered, until ArrowUp or ArrowDown holds it on its item;
  // the next keystroke releases it.
  useLayoutEffect(() => {
    const current = selectionRef.current;

    if (selectionLockRef.current !== undefined && selectionLockRef.current !== (searchText ?? '')) {
      selectionLockRef.current = undefined;
    }

    let next: MentionOptionSelection | null;

    if (current?.key === MENTION_RETRY_OPTION_KEY && !mentionOptionByKey.has(current.key)) {
      next = null;
    } else if (defaultHighlight && selectionLockRef.current === undefined) {
      const first = mentionPanelOptions.find((option) => option.kind === 'result');

      next = first && first.key === current?.key ? current : first ? mentionOptionSelection(first) : null;
    } else {
      next = reconcileMentionOptionSelection(current, mentionPanelOptions);
    }

    if (next !== current) setSelection(next);
  }, [defaultHighlight, mentionOptionByKey, mentionPanelOptions, searchText, setSelection]);

  // One report per opening of the panel ('@', '+' or '[['), sent when it inserts an item or closes,
  // to servers that advertise session_metrics_v1. Provisional sections come from stored answers.
  const shownSource: MentionSessionSource | undefined = useLocalMentionFallback
    ? 'local'
    : mentionV2View
    ? mentionV2View.source
    : mentionSectionsSource;
  // A provisional list awaits the answer to what is typed, so it never says that nothing matched,
  // unless the query stays local and no answer comes (MEN-WEB-05's one-letter rule).
  const awaitsTypedAnswer = Boolean(mentionV2View?.provisional) && !mentionSearchScheduler?.keepsLocal(searchText ?? '');
  // Only an answer that came back complete can say that nothing matched.
  const showNoResult =
    searchStatus === 'ok' &&
    rawMentionSearchResults.length === 0 &&
    !awaitsTypedAnswer &&
    (Boolean(searchText) || useLocalMentionFallback);
  const { beginSelection } = useMentionPickerSession({
    lanes: mentionRequestLanes,
    trigger: activeTrigger,
    openedAt: panelOpenedAt,
    workspaceId,
    query: searchText,
    view: {
      results: resultRanks.size,
      source: shownSource,
      // What "No result" stands for, also where the local fallback offers "Create" options instead.
      empty: showNoResult,
      failed: searchStatus === 'unavailable' || searchStatus === 'offline' || searchStatus === 'busy',
    },
  });

  // The skeleton stands in for results only while the first answer is pending. A failure, busy or
  // offline row never shows it, and neither does a retry, whose row says "Retrying…". With the
  // picker's v2, results on screen stay while the answer is pending, under a thin progress bar.
  const showMentionSearchLoadingState =
    hasMentionPanelSource && searchStatus === 'loading' && rawMentionSearchResults.length === 0;
  const showMentionSearchProgress = typeaheadV2 && searchStatus === 'loading' && rawMentionSearchResults.length > 0;
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

      const recordSelection = beginSelection();

      try {
        const response = await addPage(viewId, { name: searchText, layout: ViewLayout.Document });

        if (handleAddMention({ page_id: response.view_id, type })) {
          // The created page was no result, so the report gives no rank, section or source.
          recordSelection();
          openPageModal?.(response.view_id);
        }
      } catch (error) {
        console.error(error);
      }
    },
    [addPage, beginSelection, handleAddMention, openPageModal, searchText, viewId]
  );

  const notifyPersonMention = useNotifyPersonMention();
  const [sendNotification, setSendNotification] = useSendMentionNotification();

  const handleSelectedSearchResult = useCallback(
    (result: MentionPanelSearchResult) => {
      const recordSelection = beginSelection();
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

      if (!handleAddMention(mention)) return;

      recordSelection({
        rank: resultRanks.get(result.key),
        section: result.sectionKind,
        source: pickLocalKeys?.has(result.navKey)
          ? 'local'
          : mentionV2View?.carriedKeys?.has(result.navKey)
          ? 'cache'
          : shownSource,
      });
      // Only an insertion reinforces pick memory, never what the picker shows or highlights.
      if (pickMemory && pickMemoryKey) recordMentionPick(pickMemoryKey, searchText ?? '', result.navKey);
      if (mention.type === MentionType.Person && mention.person_id) {
        if (onPersonPicked) onPersonPicked(mention.person_id, sendNotification);
        else if (notifyOnInsert) void notifyPersonMention(mention, sendNotification);
      }
    },
    [
      beginSelection,
      editor,
      handleAddMention,
      mentionContext?.row_id,
      mentionContext?.view_id,
      mentionV2View?.carriedKeys,
      notifyOnInsert,
      notifyPersonMention,
      onPersonPicked,
      pickLocalKeys,
      pickMemory,
      pickMemoryKey,
      resultRanks,
      searchText,
      sendNotification,
      shownSource,
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

          // The highlight stays on the item the user moved to until the next keystroke (MEN-WEB-08).
          selectionLockRef.current = searchText ?? '';
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
      searchText,
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
        {showMentionSearchProgress && <MentionPanelProgressBar />}
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
            {showNoResult && createPageOptions.length === 0 && (
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
