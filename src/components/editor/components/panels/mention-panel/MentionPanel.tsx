import { Button, Divider } from '@mui/material';
import { PopoverOrigin } from '@mui/material/Popover/Popover';
import dayjs from 'dayjs';
import { sortBy, uniqBy } from 'lodash-es';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Editor as SlateEditor, Element as SlateElement, Transforms } from 'slate';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { EditorMarkFormat } from '@/application/slate-yjs/types';
import {
  Mention,
  MentionSearchSection,
  MentionTargetKind,
  MentionType,
  View,
  ViewLayout,
} from '@/application/types';
import { WorkspaceService } from '@/application/services/domains';
import { isDatabaseLayout, isEmbeddedView } from '@/application/view-utils';
import { ReactComponent as ArrowIcon } from '@/assets/icons/forward_arrow.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { ReactComponent as DatabaseIcon } from '@/assets/icons/database.svg';
import { ReactComponent as DateIcon } from '@/assets/icons/date.svg';
import { ReactComponent as DocumentIcon } from '@/assets/icons/page.svg';
import { ReactComponent as LinkIcon } from '@/assets/icons/link.svg';
import { ReactComponent as UserIcon } from '@/assets/icons/user.svg';
import { calculateOptimalOrigins, Popover } from '@/components/_shared/popover';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { usePanelContext } from '@/components/editor/components/panels/Panels.hooks';
import { PanelType } from '@/components/editor/components/panels/PanelsContext';
import { useEditorContext } from '@/components/editor/EditorContext';

import {
  buildMentionSearchRequests,
  buildMentionSearchRequestsCacheKey,
  flattenMentionSearchSections,
  mergeMentionSearchResponses,
  MentionPanelSearchResult,
  shouldCacheMentionSearchSections,
} from './mentionUtils';

enum MentionTag {
  Result = 'result',
  Page = 'page',
  LoadMore = 'loadMore',
  NewPage = 'newPage',
  Date = 'date',
}

interface Option {
  category: MentionTag;
  index: number;
}

function createMentionOptions({
  resultsLength,
  showMore,
  viewsLength,
  dateLength,
  newPageLength,
}: {
  resultsLength: number;
  showMore: boolean;
  viewsLength: number;
  dateLength: number;
  newPageLength: number;
}) {
  const options = [
    ...Array(resultsLength)
      .fill(0)
      .map((_, index) => ({
        category: MentionTag.Result,
        index,
      })),
    ...Array(viewsLength)
      .fill(0)
      .map((_, index) => ({
        category: MentionTag.Page,
        index,
      })),
    showMore && {
      category: MentionTag.LoadMore,
      index: 0,
    },
    ...Array(dateLength)
      .fill(0)
      .map((_, index) => ({
        category: MentionTag.Date,
        index,
      })),
    ...Array(newPageLength)
      .fill(0)
      .map((_, index) => ({
        category: MentionTag.NewPage,
        index,
      })),
  ].filter(Boolean) as Option[];

  return options;
}

const MENTION_SEARCH_LIMIT = 20;
const MENTION_SEARCH_CACHE_LIMIT = 50;
const DATABASE_ROW_SEARCH_RETRY_DELAY_MS = 500;

const DEFAULT_MENTION_INCLUDE = [
  MentionTargetKind.Person,
  MentionTargetKind.Page,
  MentionTargetKind.Database,
  MentionTargetKind.DatabaseRow,
  MentionTargetKind.ExternalLink,
];

const PAGE_REFERENCE_INCLUDE = [MentionTargetKind.Page, MentionTargetKind.Database, MentionTargetKind.DatabaseRow];

interface FooterAction {
  key: string;
  category: MentionTag;
  index: number;
  label: React.ReactNode;
  icon?: React.ReactNode;
  onClick: () => void;
}

function getSelectedBlockId(editor: YjsEditor): string | undefined {
  const entry = SlateEditor.above(editor, {
    match: (value) => SlateElement.isElement(value) && typeof (value as { blockId?: unknown }).blockId === 'string',
  });

  return (entry?.[0] as { blockId?: string } | undefined)?.blockId;
}

function setCachedMentionSections(
  cache: Map<string, MentionSearchSection[]>,
  key: string,
  sections: MentionSearchSection[]
) {
  if (cache.size >= MENTION_SEARCH_CACHE_LIMIT) {
    const oldestKey = cache.keys().next().value;

    if (oldestKey) {
      cache.delete(oldestKey);
    }
  }

  cache.set(key, sections);
}

function delay(ms: number) {
  return new Promise<void>((resolve) => {
    window.setTimeout(resolve, ms);
  });
}

function MentionResultIcon({ kind }: { kind: MentionTargetKind }) {
  const className = 'h-5 w-5 min-w-5 text-icon-primary';

  switch (kind) {
    case MentionTargetKind.Person:
      return <UserIcon className={className} />;
    case MentionTargetKind.Database:
      return <DatabaseIcon className={className} />;
    case MentionTargetKind.DatabaseRow:
      return <DocumentIcon className={className} />;
    case MentionTargetKind.Date:
      return <DateIcon className={className} />;
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
  const { item } = result;
  const subtitle = item.kind === MentionTargetKind.DatabaseRow ? undefined : item.subtitle;

  return (
    <Button
      color={'inherit'}
      size={'small'}
      data-option-index={index}
      startIcon={<MentionResultIcon kind={item.kind} />}
      className={`min-h-[32px] scroll-m-2 justify-start hover:bg-fill-content-hover ${
        selected ? 'bg-fill-content-hover' : ''
      }`}
      onClick={onClick}
    >
      <span className={'flex min-w-0 flex-col items-start'}>
        <span className={'max-w-[240px] truncate'}>{item.title}</span>
        {subtitle && <span className={'max-w-[240px] truncate text-xs text-text-secondary'}>{subtitle}</span>}
      </span>
    </Button>
  );
}

function FooterActionButton({ action, selected }: { action: FooterAction; selected: boolean }) {
  return (
    <Button
      color={'inherit'}
      startIcon={action.icon}
      size={'small'}
      data-option-index={action.index}
      className={`min-h-[32px] scroll-m-2 justify-start hover:bg-fill-content-hover ${
        selected ? 'bg-fill-content-hover' : ''
      }`}
      onClick={action.onClick}
    >
      {action.label}
    </Button>
  );
}

export function MentionPanel() {
  const { isPanelOpen, panelPosition, closePanel, searchText, removeContent, activePanel } = usePanelContext();
  const showDate = activePanel === PanelType.Mention;
  const { workspaceId, viewId, loadViews, addPage, openPageModal, searchMentions, mentionContext, loadViewMeta } =
    useEditorContext();
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const open = useMemo(() => {
    return isPanelOpen(PanelType.Mention) || isPanelOpen(PanelType.PageReference);
  }, [isPanelOpen]);
  const selectedOptionRef = React.useRef<Option | null>(null);
  const [selectedOption, setSelectedOption] = React.useState<Option | null>(null);
  const editor = useSlateStatic() as YjsEditor;
  const [moreCount, setMoreCount] = useState<number>(5);
  const [views, setViews] = useState<View[]>([]);
  const [mentionSections, setMentionSections] = useState<MentionSearchSection[]>([]);
  const [mentionSearchLoading, setMentionSearchLoading] = useState(false);
  const [mentionSearchFailed, setMentionSearchFailed] = useState(false);
  const mentionSearchCacheRef = useRef<Map<string, MentionSearchSection[]>>(new Map());
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
  const mentionSearchRequests = useMemo(
    () => buildMentionSearchRequests(mentionSearchRequest),
    [mentionSearchRequest]
  );
  const mentionSearchCacheKey = useMemo(
    () => buildMentionSearchRequestsCacheKey(mentionSearchRequests),
    [mentionSearchRequests]
  );
  const useServerMentionSearch = Boolean(searchMentions);
  const useLegacyMentionSearch = !useServerMentionSearch || mentionSearchFailed;

  useEffect(() => {
    if (!open) {
      selectedOptionRef.current = null;
      setSelectedOption(null);
      setMoreCount(5);
    }
  }, [open]);

  useEffect(() => {
    if (!open || !loadViews || !useLegacyMentionSearch) return;

    void (async () => {
      try {
        const views = await loadViews();

        // Collect mentionable views in a single tree walk, skipping:
        // 1. Spaces (not pages)
        // 2. Child views of databases (e.g. "View of Trip" Grid/Board under "Trip")
        // 3. Embedded database views under documents (database blocks inside a doc)
        const mentionable: View[] = [];
        const collectMentionable = (items: View[], parentIsDatabase: boolean) => {
          for (const view of items) {
            const isDb = isDatabaseLayout(view.layout);
            const skip = view.extra?.is_space || parentIsDatabase || isEmbeddedView(view);

            if (!skip) {
              mentionable.push(view);
            }

            collectMentionable(view.children || [], parentIsDatabase || isDb);
          }
        };

        collectMentionable(views || [], false);

        const result = sortBy(uniqBy(mentionable, 'view_id'), 'last_edited_time').reverse();

        setViews(result);
      } catch (e) {
        console.error(e);
      }
    })();
  }, [loadViews, open, useLegacyMentionSearch]);

  useEffect(() => {
    if (!open || !searchMentions) {
      setMentionSections([]);
      setMentionSearchFailed(false);
      setMentionSearchLoading(false);
      return;
    }

    selectedOptionRef.current = null;
    setSelectedOption(null);

    const cachedSections = mentionSearchCacheRef.current.get(mentionSearchCacheKey);

    if (cachedSections) {
      setMentionSections(cachedSections);
      setMentionSearchFailed(false);
      setMentionSearchLoading(false);
      return;
    }

    let cancelled = false;
    const requestId = mentionSearchRequestIdRef.current + 1;

    mentionSearchRequestIdRef.current = requestId;
    setMentionSections([]);
    setMentionSearchFailed(false);
    setMentionSearchLoading(true);

    const timer = window.setTimeout(
      () => {
        void Promise.all(mentionSearchRequests.map((request) => searchMentions(request)))
          .then(async (responses) => {
            if (cancelled || mentionSearchRequestIdRef.current !== requestId) return;

            let sections = mergeMentionSearchResponses(responses).sections ?? [];

            if (!shouldCacheMentionSearchSections(mentionSearchRequests, sections, hasMentionSearchQuery)) {
              const rowRequest = mentionSearchRequests.find((request) => {
                const include = request.include ?? [];

                return include.length === 1 && include[0] === MentionTargetKind.DatabaseRow;
              });

              if (rowRequest) {
                await delay(DATABASE_ROW_SEARCH_RETRY_DELAY_MS);

                if (cancelled || mentionSearchRequestIdRef.current !== requestId) return;

                try {
                  const rowRetryResponse = await searchMentions(rowRequest);

                  sections = mergeMentionSearchResponses([...responses, rowRetryResponse]).sections ?? [];
                } catch (error) {
                  console.error(error);
                }
              }
            }

            if (cancelled || mentionSearchRequestIdRef.current !== requestId) return;

            if (shouldCacheMentionSearchSections(mentionSearchRequests, sections, hasMentionSearchQuery)) {
              setCachedMentionSections(mentionSearchCacheRef.current, mentionSearchCacheKey, sections);
            }
            setMentionSections(sections);
            setMentionSearchFailed(false);
          })
          .catch((error) => {
            if (cancelled || mentionSearchRequestIdRef.current !== requestId) return;

            console.error(error);
            setMentionSections([]);
            setMentionSearchFailed(true);
          })
          .finally(() => {
            if (cancelled || mentionSearchRequestIdRef.current !== requestId) return;

            setMentionSearchLoading(false);
          });
      },
      hasMentionSearchQuery ? 120 : 0
    );

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [hasMentionSearchQuery, mentionSearchCacheKey, mentionSearchRequests, open, searchMentions]);

  const filteredViews = useMemo(() => {
    return views.filter((view) => {
      if (!searchText) return true;
      return view.name.toLowerCase().includes(searchText.toLowerCase());
    });
  }, [searchText, views]);

  const splicedViews = useMemo(() => {
    return filteredViews.slice(0, moreCount);
  }, [filteredViews, moreCount]);

  const showMore = moreCount < filteredViews.length;
  const mentionSearchResults = useMemo(
    () =>
      useServerMentionSearch && !mentionSearchFailed
        ? flattenMentionSearchSections(mentionSections).filter(
            (result) => hasMentionSearchQuery || result.item.kind !== MentionTargetKind.DatabaseRow
          )
        : [],
    [hasMentionSearchQuery, mentionSearchFailed, mentionSections, useServerMentionSearch]
  );
  const mentionResultSections = useMemo(() => {
    const resultsBySection = new Map<number, MentionPanelSearchResult[]>();

    mentionSearchResults.forEach((result) => {
      const results = resultsBySection.get(result.sectionIndex) ?? [];

      results.push(result);
      resultsBySection.set(result.sectionIndex, results);
    });

    return mentionSections
      .map((section, sectionIndex) => ({
        section,
        results: resultsBySection.get(sectionIndex) ?? [],
      }))
      .filter(({ results }) => results.length > 0);
  }, [mentionSearchResults, mentionSections]);
  const mentionResultIndexByKey = useMemo(() => {
    return new Map(mentionSearchResults.map((result, index) => [result.key, index]));
  }, [mentionSearchResults]);

  useEffect(() => {
    selectedOptionRef.current = selectedOption;
    if (!selectedOption) return;
    const { category, index } = selectedOption;

    const el = ref.current?.querySelector(
      `[data-option-category="${category}"] [data-option-index="${index}"]`
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

  const handleSelectedPage = useCallback(
    (viewId: string, type = MentionType.PageRef) => {
      handleAddMention({
        page_id: viewId,
        type,
      });
    },
    [handleAddMention]
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

  const handleAddPage = useCallback(
    async (type = MentionType.PageRef) => {
      if (!addPage || !viewId) return;
      try {
        const response = await addPage(viewId, { name: searchText, layout: ViewLayout.Document });

        handleSelectedPage(response.view_id, type);
        openPageModal?.(response.view_id);
      } catch (e) {
        console.error(e);
      }
    },
    [addPage, searchText, handleSelectedPage, viewId, openPageModal]
  );
  const dateOptions = useMemo(() => {
    if (!showDate) return [];
    const onClick = (value: string) => {
      let date: string | undefined;

      switch (value) {
        case 'today':
          date = dayjs().toISOString();
          break;
        case 'tomorrow':
          date = dayjs().add(1, 'day').toISOString();
          break;
        case 'yesterday':
          date = dayjs().subtract(1, 'day').toISOString();
          break;
        default:
          break;
      }

      if (!date) return;

      handleAddMention({
        date,
        type: MentionType.Date,
      });
    };

    return [
      {
        name: t('relativeDates.today'),
        value: 'today',
        onClick: () => onClick('today'),
      },
      {
        name: t('relativeDates.tomorrow'),
        value: 'tomorrow',
        onClick: () => onClick('tomorrow'),
      },
      {
        name: t('relativeDates.yesterday'),
        value: 'yesterday',
        onClick: () => onClick('yesterday'),
      },
    ].filter((option) => (searchText ? option.name.toLowerCase().includes(searchText.toLowerCase()) : true));
  }, [handleAddMention, t, showDate, searchText]);

  const handleClickMore = useCallback(() => {
    setMoreCount(moreCount + 5);

    setSelectedOption((prev) => {
      if (!prev) return null;
      return {
        category: MentionTag.Page,
        index: moreCount,
      };
    });
  }, [moreCount]);

  const dateFooterActions = useMemo<FooterAction[]>(
    () =>
      dateOptions.map((option, index) => ({
        key: option.value,
        category: MentionTag.Date,
        index,
        label: option.name,
        onClick: option.onClick,
      })),
    [dateOptions]
  );
  const createFooterActions = useMemo<FooterAction[]>(
    () => [
      {
        key: 'new-sub-page',
        category: MentionTag.NewPage,
        index: 0,
        icon: <AddIcon />,
        label: (
          <>
            <span>{t('button.create')}</span>
            <span className={'mx-1'}>{searchText ? `"${searchText}"` : 'new'}</span>
            <span>{t('document.slashMenu.subPage.keyword1')}</span>
          </>
        ),
        onClick: () => {
          setSelectedOption({
            category: MentionTag.NewPage,
            index: 0,
          });
          void handleAddPage(MentionType.childPage);
        },
      },
      {
        key: 'new-page-in',
        category: MentionTag.NewPage,
        index: 1,
        icon: <ArrowIcon className={'mx-0.5'} />,
        label: (
          <>
            <span>{t('button.create')}</span>
            <span className={'mx-1'}>{searchText ? `"${searchText}"` : 'new'}</span>
            <span>page in...</span>
          </>
        ),
        onClick: () => {
          setSelectedOption({
            category: MentionTag.NewPage,
            index: 1,
          });
          void handleAddPage(MentionType.PageRef);
        },
      },
    ],
    [handleAddPage, searchText, t]
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

            if (selectedOptionRef.current.category === MentionTag.Result) {
              const result = mentionSearchResults[index];

              if (result) {
                handleSelectedSearchResult(result);
              }
            } else if (selectedOptionRef.current.category === MentionTag.NewPage) {
              void handleAddPage(index === 0 ? MentionType.childPage : MentionType.PageRef);
            } else if (selectedOptionRef.current.category === MentionTag.Page) {
              const viewId = splicedViews[index]?.view_id;

              if (viewId) {
                handleSelectedPage(viewId, MentionType.PageRef);
              }
            } else if (selectedOptionRef.current.category === MentionTag.Date) {
              dateFooterActions[index]?.onClick();
            } else if (selectedOptionRef.current.category === MentionTag.LoadMore) {
              handleClickMore();
            }
          }

          break;
        case 'ArrowUp':
        case 'ArrowDown': {
          e.stopPropagation();
          e.preventDefault();
          const options = createMentionOptions({
            resultsLength: mentionSearchResults.length,
            viewsLength: useLegacyMentionSearch ? splicedViews.length : 0,
            dateLength: dateFooterActions.length,
            newPageLength: createFooterActions.length,
            showMore: useLegacyMentionSearch && showMore,
          });

          if (options.length === 0) break;

          if (!selectedOptionRef.current) {
            if (e.key === 'ArrowDown') {
              setSelectedOption(options[0]);
            } else {
              setSelectedOption(options[options.length - 1]);
            }

            break;
          }

          const { category, index } = selectedOptionRef.current;
          const currentIndex = options.findIndex((option) => option.category === category && option.index === index);

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
  }, [
    editor,
    handleClickMore,
    handleAddPage,
    handleSelectedPage,
    handleSelectedSearchResult,
    open,
    selectedOptionRef,
    mentionSearchResults,
    splicedViews,
    dateFooterActions,
    createFooterActions,
    showMore,
    useLegacyMentionSearch,
  ]);
  const [transformOrigin, setTransformOrigin] = React.useState<PopoverOrigin | undefined>(undefined);

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
      onMouseDown={(e) => e.preventDefault()}
    >
      <div
        ref={ref}
        className={'appflowy-scroller relative flex max-h-[560px] w-[320px] flex-col gap-2 overflow-y-auto p-2'}
      >
        {useServerMentionSearch && !mentionSearchFailed && (
          <div data-option-category={MentionTag.Result} className={'flex flex-col gap-2'}>
            {mentionResultSections.map(({ section, results }) => (
              <div
                key={`${section.kind}:${section.title}`}
                data-section-kind={section.kind}
                className={'flex flex-col gap-2'}
              >
                <div className={'scroll-my-10 px-1 text-text-secondary'}>{section.title}</div>
                {results.map((result) => {
                  const index = mentionResultIndexByKey.get(result.key) ?? 0;

                  return (
                    <MentionResultButton
                      key={result.key}
                      result={result}
                      index={index}
                      selected={selectedOption?.index === index && selectedOption?.category === MentionTag.Result}
                      onClick={() => handleSelectedSearchResult(result)}
                    />
                  );
                })}
              </div>
            ))}
            {!mentionSearchLoading && mentionSearchResults.length === 0 && searchText && (
              <div className={'flex items-center justify-center p-2 text-sm text-text-secondary'}>
                {t('findAndReplace.noResult')}
              </div>
            )}
          </div>
        )}

        {useLegacyMentionSearch && (
          <>
            <div className={'scroll-my-10 px-1 text-text-secondary'}>{t('inlineActions.recentPages')}</div>
            <div data-option-category={MentionTag.Page} className={'flex flex-col gap-2'}>
              {splicedViews && splicedViews.length > 0 ? (
                <div className={'flex w-full flex-col gap-2'}>
                  {splicedViews.map((view, index) => (
                    <Button
                      color={'inherit'}
                      size={'small'}
                      key={view.view_id}
                      data-option-index={index}
                      startIcon={<PageIcon view={view} className={'flex h-5 w-5 min-w-5 items-center justify-center'} />}
                      className={`min-h-[32px] scroll-m-2 justify-start truncate hover:bg-fill-content-hover ${
                        selectedOption?.index === index && selectedOption?.category === MentionTag.Page
                          ? 'bg-fill-content-hover'
                          : ''
                      }`}
                      onClick={() => handleSelectedPage(view.view_id)}
                    >
                      {view.name || t('menuAppHeader.defaultNewPageName')}
                    </Button>
                  ))}
                </div>
              ) : (
                <div className={'flex items-center justify-center p-2 text-sm text-text-secondary'}>
                  {t('findAndReplace.noResult')}
                </div>
              )}
              {showMore && (
                <div data-option-category={MentionTag.LoadMore} className={'w-full'}>
                  <Button
                    color={'inherit'}
                    size={'small'}
                    data-option-index={0}
                    startIcon={<MoreIcon />}
                    className={`min-h-[32px] w-full scroll-m-2 justify-start hover:bg-fill-content-hover ${
                      selectedOption?.index === 0 && selectedOption?.category === MentionTag.LoadMore
                        ? 'bg-fill-content-hover'
                        : ''
                    }`}
                    onClick={handleClickMore}
                  >
                    {filteredViews.length - moreCount} {t('document.mention.morePages')}
                  </Button>
                </div>
              )}
            </div>
          </>
        )}

        <div className={'flex w-full flex-col gap-2'}>
          {dateFooterActions.length > 0 && (
            <div className={'flex flex-col gap-2'} data-option-category={MentionTag.Date}>
              <div className={'scroll-my-10 px-1 text-text-secondary'}>{t('inlineActions.date')}</div>
              {dateFooterActions.map((action) => (
                <FooterActionButton
                  key={action.key}
                  action={action}
                  selected={selectedOption?.index === action.index && selectedOption?.category === action.category}
                />
              ))}
            </div>
          )}

          <div data-option-category={MentionTag.NewPage} className={'flex w-full flex-col gap-2'}>
            <Divider />
            {createFooterActions.map((action) => (
              <FooterActionButton
                key={action.key}
                action={action}
                selected={selectedOption?.index === action.index && selectedOption?.category === action.category}
              />
            ))}
          </div>
        </div>
      </div>
    </Popover>
  );
}

export default MentionPanel;
