import { Button, Divider } from '@mui/material';
import { PopoverOrigin } from '@mui/material/Popover/Popover';
import dayjs from 'dayjs';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Editor as SlateEditor, Element as SlateElement, Transforms } from 'slate';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { WorkspaceService } from '@/application/services/domains';
import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import {
  Mention,
  MentionSearchRequest,
  MentionSearchResponse,
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
  MentionType,
  View,
  ViewLayout,
} from '@/application/types';
import { isDatabaseLayout, isEmbeddedView } from '@/application/view-utils';
import { ReactComponent as ArrowIcon } from '@/assets/icons/forward_arrow.svg';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { ReactComponent as DateIcon } from '@/assets/icons/date.svg';
import { ReactComponent as LinkIcon } from '@/assets/icons/link.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as DocumentIcon } from '@/assets/icons/page.svg';
import { ReactComponent as ReminderIcon } from '@/assets/icons/reminder_clock.svg';
import { calculateOptimalOrigins, Popover } from '@/components/_shared/popover';
import { usePanelContext } from '@/components/editor/components/panels/Panels.hooks';
import { PanelType } from '@/components/editor/components/panels/PanelsContext';
import { useEditorContext } from '@/components/editor/EditorContext';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

import {
  getCachedMentionSections,
  isMentionSearchRetryLater,
  markMentionSearchRetryLater,
  mentionSearchRetryLaterRemainingMs,
  setCachedMentionSections,
  startMentionSearchRefresh,
} from './mentionSearchCache';
import {
  buildMentionSearchRequests,
  buildMentionSearchRequestsCacheKey,
  flattenMentionSearchSections,
  getMentionSearchResultDisplayTitle,
  mergeMentionSearchResponses,
  MentionPanelSearchResult,
  normalizeMentionSearchSectionsForPicker,
  shouldCacheMentionSearchSections,
} from './mentionUtils';

enum MentionTag {
  Result = 'result',
}

interface Option {
  index: number;
}

function createMentionOptions(resultsLength: number) {
  return Array.from({ length: resultsLength }, (_, index) => ({ index }));
}

const MENTION_SEARCH_LIMIT = 20;
const DATABASE_ROW_SEARCH_RETRY_DELAY_MS = 500;
const PAGE_RESULT_COLLAPSE_LIMIT = 4;

type MentionPanelOption =
  | {
      kind: 'result';
      key: string;
      result: MentionPanelSearchResult;
    }
  | {
      kind: 'morePages';
      key: string;
      remainingCount: number;
    }
  | {
      kind: 'createPage';
      key: string;
      createType: MentionType.childPage | MentionType.PageRef;
    };

type MentionPanelResultOption = Extract<MentionPanelOption, { kind: 'result' | 'morePages' }>;
type MentionPanelCreatePageOption = Extract<MentionPanelOption, { kind: 'createPage' }>;

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

const PAGE_REFERENCE_INCLUDE = [MentionTargetKind.Page, MentionTargetKind.Database, MentionTargetKind.DatabaseRow];

function getMentionablePageViews(views: View[] = []) {
  const mentionable: View[] = [];
  const collectMentionable = (items: View[], parentIsDatabase: boolean) => {
    items.forEach((view) => {
      const isDatabase = isDatabaseLayout(view.layout);
      const skip = view.extra?.is_space || parentIsDatabase || isEmbeddedView(view);

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

function isDatabaseRowOnlyRequest(request: MentionSearchRequest) {
  const include = request.include ?? [];

  return include.length === 1 && include[0] === MentionTargetKind.DatabaseRow;
}

function getSelectedBlockId(editor: YjsEditor): string | undefined {
  const entry = SlateEditor.above(editor, {
    match: (value) => SlateElement.isElement(value) && typeof (value as { blockId?: unknown }).blockId === 'string',
  });

  return (entry?.[0] as { blockId?: string } | undefined)?.blockId;
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
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
      return <DocumentIcon className={className} />;
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
  index,
  selected,
  onClick,
}: {
  result: MentionPanelSearchResult;
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
  index,
  selected,
  onClick,
}: {
  remainingCount: number;
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
  index,
  selected,
  onClick,
}: {
  createType: MentionType.childPage | MentionType.PageRef;
  searchText?: string;
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

function MentionSectionTitle({ section }: { section: MentionSearchSection }) {
  return (
    <div className={'flex min-h-7 items-center px-0 text-sm font-semibold text-text-tertiary'}>
      <span className={'truncate'}>{section.title}</span>
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

export function MentionPanel() {
  const { isPanelOpen, panelPosition, closePanel, searchText, removeContent, activePanel } = usePanelContext();
  const { workspaceId, viewId, searchMentions, mentionContext, loadViewMeta, loadViews, addPage, openPageModal } =
    useEditorContext();
  const currentUser = useCurrentUserOptional();
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const open = isPanelOpen(PanelType.Mention) || isPanelOpen(PanelType.PageReference);
  const useLocalMentionFallback = open && !searchMentions && Boolean(loadViews);
  const hasMentionPanelSource = Boolean(searchMentions) || useLocalMentionFallback;
  const selectedOptionRef = useRef<Option | null>(null);
  const [selectedOption, setSelectedOption] = useState<Option | null>(null);
  const editor = useSlateStatic() as YjsEditor;
  const [mentionSections, setMentionSections] = useState<MentionSearchSection[]>([]);
  const [mentionSearchLoading, setMentionSearchLoading] = useState(false);
  const [mentionSearchFailed, setMentionSearchFailed] = useState(false);
  const [mentionSearchDeferred, setMentionSearchDeferred] = useState(false);
  const [showMorePages, setShowMorePages] = useState(false);
  const [localFallbackViews, setLocalFallbackViews] = useState<View[]>([]);
  const mentionSearchRequestIdRef = useRef(0);
  const hasMentionSearchQuery = Boolean(searchText?.trim());
  const mentionInclude = useMemo(
    () => (activePanel === PanelType.PageReference ? PAGE_REFERENCE_INCLUDE : DEFAULT_MENTION_INCLUDE),
    [activePanel]
  );
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
  const mentionSearchCacheKey = useMemo(
    () =>
      buildMentionSearchRequestsCacheKey(mentionSearchRequests, {
        workspaceId,
        userId: currentUser?.uuid,
      }),
    [currentUser?.uuid, mentionSearchRequests, workspaceId]
  );
  const localFallbackMentionSections = useMemo(() => {
    if (!useLocalMentionFallback) return [];

    const query = searchText?.trim().toLowerCase() ?? '';
    const includeDates = activePanel === PanelType.Mention;
    const pageItems = getMentionablePageViews(localFallbackViews)
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
  }, [activePanel, localFallbackViews, searchText, t, useLocalMentionFallback]);
  const sourceMentionSections = useLocalMentionFallback ? localFallbackMentionSections : mentionSections;
  const pickerMentionSections = useMemo(
    () => normalizeMentionSearchSectionsForPicker(sourceMentionSections),
    [sourceMentionSections]
  );

  useEffect(() => {
    if (!open) {
      selectedOptionRef.current = null;
      setSelectedOption(null);
      setShowMorePages(false);
    }
  }, [open]);

  useEffect(() => {
    setShowMorePages(false);
  }, [mentionSearchCacheKey]);

  useEffect(() => {
    if (!open || !searchMentions) {
      if (useLocalMentionFallback) return;

      setMentionSections([]);
      setMentionSearchFailed(false);
      setMentionSearchDeferred(false);
      setMentionSearchLoading(false);
      return;
    }

    selectedOptionRef.current = null;
    setSelectedOption(null);

    const searchMentionsFn = searchMentions;
    let cancelled = false;
    let timer: number | undefined;
    const requestId = mentionSearchRequestIdRef.current + 1;
    const cachedSections = getCachedMentionSections(mentionSearchCacheKey);

    mentionSearchRequestIdRef.current = requestId;

    if (cachedSections) {
      setMentionSections(cachedSections);
      setMentionSearchFailed(false);
      setMentionSearchDeferred(false);
      setMentionSearchLoading(false);

      if (mentionSearchRetryLaterRemainingMs(mentionSearchCacheKey) === 0) {
        void startMentionSearchRefresh(mentionSearchCacheKey, async () => {
          const sections = await fetchMentionSections();

          cacheMentionSections(sections);

          if (isCurrentRequest()) {
            setMentionSections(sections);
            setMentionSearchFailed(false);
          }
        }).catch((error) => {
          if (isMentionSearchRetryLater(error)) {
            markMentionSearchRetryLater(mentionSearchCacheKey, error);
            return;
          }

          console.error(error);
        });
      }

      return () => {
        cancelled = true;
      };
    }

    setMentionSections([]);
    setMentionSearchFailed(false);
    setMentionSearchDeferred(false);

    function isCurrentRequest() {
      return !cancelled && mentionSearchRequestIdRef.current === requestId;
    }

    function cacheMentionSections(sections: MentionSearchSection[]) {
      if (shouldCacheMentionSearchSections(mentionSearchRequests, sections, hasMentionSearchQuery)) {
        setCachedMentionSections(mentionSearchCacheKey, sections);
      }
    }

    async function fetchMentionSections() {
      const settledResponses = await Promise.allSettled(
        mentionSearchRequests.map(async (request) => ({
          request,
          response: await searchMentionsFn(request),
        }))
      );
      const responses: MentionSearchResponse[] = [];
      let blockingError: unknown;

      settledResponses.forEach((result, index) => {
        if (result.status === 'fulfilled') {
          responses.push(result.value.response);
          return;
        }

        const request = mentionSearchRequests[index];

        if (request && isDatabaseRowOnlyRequest(request)) {
          if (isMentionSearchRetryLater(result.reason)) {
            markMentionSearchRetryLater(mentionSearchCacheKey, result.reason);
          } else {
            console.error(result.reason);
          }

          return;
        }

        blockingError = blockingError ?? result.reason;
      });

      if (blockingError) {
        throw blockingError;
      }

      const initialSections = mergeMentionSearchResponses(responses).sections ?? [];
      let sections = initialSections;
      const shouldCacheInitialSections = shouldCacheMentionSearchSections(
        mentionSearchRequests,
        initialSections,
        hasMentionSearchQuery
      );

      if (!shouldCacheInitialSections) {
        const rowRequest = mentionSearchRequests.find(isDatabaseRowOnlyRequest);

        if (rowRequest) {
          await delay(DATABASE_ROW_SEARCH_RETRY_DELAY_MS);

          if (!isCurrentRequest()) return sections;

          try {
            const rowRetryResponse = await searchMentionsFn(rowRequest);

            sections = mergeMentionSearchResponses([...responses, rowRetryResponse]).sections ?? [];
          } catch (error) {
            if (isMentionSearchRetryLater(error)) {
              markMentionSearchRetryLater(mentionSearchCacheKey, error);
            } else {
              console.error(error);
            }
          }
        }
      }

      return sections;
    }

    function scheduleSearch(delayMs: number) {
      window.clearTimeout(timer);
      timer = window.setTimeout(runSearch, delayMs);
    }

    function runSearch() {
      void fetchMentionSections()
        .then((sections) => {
          if (!isCurrentRequest()) return;

          cacheMentionSections(sections);
          setMentionSections(sections);
          setMentionSearchFailed(false);
          setMentionSearchDeferred(false);
        })
        .catch((error) => {
          if (!isCurrentRequest()) return;

          if (isMentionSearchRetryLater(error)) {
            markMentionSearchRetryLater(mentionSearchCacheKey, error);
            const fallbackSections = getCachedMentionSections(mentionSearchCacheKey);

            if (fallbackSections) {
              setMentionSections(fallbackSections);
              setMentionSearchFailed(false);
              setMentionSearchDeferred(false);
              return;
            }

            setMentionSearchDeferred(true);
            setMentionSearchFailed(false);
            scheduleSearch(mentionSearchRetryLaterRemainingMs(mentionSearchCacheKey));
            return;
          }

          console.error(error);
          setMentionSections([]);
          setMentionSearchFailed(true);
          setMentionSearchDeferred(false);
        })
        .finally(() => {
          if (!isCurrentRequest()) return;

          setMentionSearchLoading(false);
        });
    }

    const retryLaterMs = mentionSearchRetryLaterRemainingMs(mentionSearchCacheKey);

    if (retryLaterMs > 0) {
      setMentionSearchDeferred(true);
      setMentionSearchLoading(false);
      scheduleSearch(retryLaterMs);
    } else {
      setMentionSearchLoading(true);
      scheduleSearch(hasMentionSearchQuery ? 120 : 0);
    }

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasMentionSearchQuery, mentionSearchCacheKey, mentionSearchRequests, open, searchMentions, useLocalMentionFallback]);

  useEffect(() => {
    if (!useLocalMentionFallback || !loadViews) return;

    let cancelled = false;

    selectedOptionRef.current = null;
    setSelectedOption(null);
    setMentionSearchFailed(false);
    setMentionSearchDeferred(false);
    setMentionSearchLoading(true);

    void loadViews()
      .then((views) => {
        if (cancelled) return;

        setLocalFallbackViews(views ?? []);
        setMentionSearchFailed(false);
      })
      .catch((error) => {
        if (cancelled) return;

        console.error(error);
        setLocalFallbackViews([]);
        setMentionSearchFailed(true);
      })
      .finally(() => {
        if (cancelled) return;

        setMentionSearchLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [loadViews, useLocalMentionFallback]);

  useEffect(() => {
    if (useLocalMentionFallback) return;

    setLocalFallbackViews([]);
  }, [useLocalMentionFallback]);

  useEffect(() => {
    if (!useLocalMentionFallback) return;

    selectedOptionRef.current = null;
    setSelectedOption(null);
  }, [searchText, useLocalMentionFallback]);

  const rawMentionSearchResults = useMemo(
    () =>
      flattenMentionSearchSections(pickerMentionSections).filter(
        (result) => hasMentionSearchQuery || result.item.kind !== MentionTargetKind.DatabaseRow
      ),
    [hasMentionSearchQuery, pickerMentionSections]
  );
  const canCreatePageInLocalFallback = useLocalMentionFallback && !mentionSearchLoading && Boolean(addPage && viewId);
  const { mentionResultSections, mentionPanelOptions, createPageOptions } = useMemo(() => {
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
          result,
        }));

        if (shouldCollapse) {
          sectionOptions.push({
            kind: 'morePages',
            key: `${section.kind}:${sectionIndex}:more`,
            remainingCount: results.length - PAGE_RESULT_COLLAPSE_LIMIT,
          });
        }

        options.push(...sectionOptions);

        return {
          section,
          options: sectionOptions,
        };
      })
      .filter((section): section is MentionPanelResultSection => Boolean(section));
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

    options.push(...createOptions);

    return {
      mentionResultSections: sections,
      mentionPanelOptions: options,
      createPageOptions: createOptions,
    };
  }, [canCreatePageInLocalFallback, pickerMentionSections, rawMentionSearchResults, showMorePages]);
  const mentionOptionIndexByKey = useMemo(() => {
    return new Map(mentionPanelOptions.map((option, index) => [option.key, index]));
  }, [mentionPanelOptions]);
  const showMentionSearchLoadingState =
    hasMentionPanelSource && (mentionSearchLoading || mentionSearchDeferred) && rawMentionSearchResults.length === 0;

  useEffect(() => {
    selectedOptionRef.current = selectedOption;
    if (!selectedOption) return;
    const { index } = selectedOption;

    const el = ref.current?.querySelector(
      `[data-option-category="${MentionTag.Result}"] [data-option-index="${index}"]`
    ) as HTMLButtonElement | null;

    el?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }, [selectedOption]);

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

  const notifyPersonMention = useCallback(
    async (mention: Mention) => {
      if (mention.type !== MentionType.Person || !mention.person_id || !workspaceId) return;

      const targetViewId = mention.page_id || mentionContext?.view_id || viewId;

      if (!targetViewId) return;

      const rowId = mention.row_id || mentionContext?.row_id;
      let viewName = t('menuAppHeader.defaultNewPageName');
      let viewLayout: ViewLayout | undefined;

      try {
        const meta = await loadViewMeta?.(targetViewId);

        viewName = meta?.name || viewName;
        viewLayout = meta?.layout;
      } catch {
        // Keep the stored mention usable even when metadata is unavailable.
      }

      try {
        await WorkspaceService.updatePageMention(workspaceId, targetViewId, {
          person_id: mention.person_id,
          block_id: mention.block_id ?? null,
          row_id: rowId ?? null,
          require_notification: true,
          view_name: viewName,
          view_layout: viewLayout,
          is_row_document: Boolean(rowId),
        });
      } catch (error) {
        console.error('Failed to update page mention:', error);
      }
    },
    [loadViewMeta, mentionContext?.row_id, mentionContext?.view_id, t, viewId, workspaceId]
  );

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

      if (handleAddMention(mention) && mention.type === MentionType.Person) {
        void notifyPersonMention(mention);
      }
    },
    [editor, handleAddMention, mentionContext?.row_id, mentionContext?.view_id, notifyPersonMention, viewId]
  );

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      const { key } = e;

      switch (key) {
        case 'Enter':
          e.preventDefault();
          if (selectedOptionRef.current) {
            const index = selectedOptionRef.current.index;
            const option = mentionPanelOptions[index];

            if (option?.kind === 'result') {
              handleSelectedSearchResult(option.result);
            } else if (option?.kind === 'morePages') {
              setShowMorePages(true);
            } else if (option?.kind === 'createPage') {
              void handleAddPage(option.createType);
            }
          }

          break;
        case 'Escape':
          e.stopPropagation();
          e.preventDefault();
          closePanel();
          break;
        case 'ArrowUp':
        case 'ArrowDown': {
          e.stopPropagation();
          e.preventDefault();
          const options = createMentionOptions(mentionPanelOptions.length);

          if (options.length === 0) break;

          if (!selectedOptionRef.current) {
            if (e.key === 'ArrowDown') {
              setSelectedOption(options[0]);
            } else {
              setSelectedOption(options[options.length - 1]);
            }

            break;
          }

          const { index } = selectedOptionRef.current;
          const currentIndex = options.findIndex((option) => option.index === index);

          if (currentIndex === -1) {
            setSelectedOption(e.key === 'ArrowDown' ? options[0] : options[options.length - 1]);
            break;
          }

          const nextIndex =
            e.key === 'ArrowDown'
              ? (currentIndex + 1) % options.length
              : (currentIndex - 1 + options.length) % options.length;

          setSelectedOption(options[nextIndex]);

          break;
        }

        default:
          break;
      }
    };

    const slateDom = ReactEditor.toDOMNode(editor, editor);

    slateDom.addEventListener('keydown', handleKeyDown);

    return () => {
      slateDom.removeEventListener('keydown', handleKeyDown);
    };
  }, [closePanel, editor, handleAddPage, handleSelectedSearchResult, mentionPanelOptions, open, selectedOptionRef]);
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
                  <MentionSectionTitle section={section} />
                  {options.map((option) => {
                    const index = mentionOptionIndexByKey.get(option.key) ?? 0;

                    if (option.kind === 'morePages') {
                      return (
                        <MentionMoreResultsButton
                          key={option.key}
                          remainingCount={option.remainingCount}
                          index={index}
                          selected={selectedOption?.index === index}
                          onClick={() => setShowMorePages(true)}
                        />
                      );
                    }

                    return (
                      <MentionResultButton
                        key={option.key}
                        result={option.result}
                        index={index}
                        selected={selectedOption?.index === index}
                        onClick={() => handleSelectedSearchResult(option.result)}
                      />
                    );
                  })}
                </div>
              ))
            )}
            {!mentionSearchLoading &&
              !mentionSearchDeferred &&
              rawMentionSearchResults.length === 0 &&
              createPageOptions.length === 0 &&
              (searchText || mentionSearchFailed || useLocalMentionFallback) && (
                <div className={'flex items-center justify-center p-2 text-sm text-text-secondary'}>
                  {t('findAndReplace.noResult')}
                </div>
              )}
            {createPageOptions.length > 0 && (
              <div className={'flex flex-col px-2 py-1'}>
                {mentionResultSections.length > 0 && <Divider className={'-mx-2 mb-1 border-border-primary'} />}
                {createPageOptions.map((option) => {
                  const index = mentionOptionIndexByKey.get(option.key) ?? 0;

                  return (
                    <MentionCreatePageButton
                      key={option.key}
                      createType={option.createType}
                      searchText={searchText}
                      index={index}
                      selected={selectedOption?.index === index}
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
