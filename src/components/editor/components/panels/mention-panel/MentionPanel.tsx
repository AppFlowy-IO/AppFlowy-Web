import { Button, Divider } from '@mui/material';
import { PopoverOrigin } from '@mui/material/Popover/Popover';
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
  MentionSearchResultItem,
  MentionSearchSection,
  MentionSearchSectionKind,
  MentionTargetKind,
  MentionType,
  ViewLayout,
} from '@/application/types';
import { ReactComponent as DateIcon } from '@/assets/icons/date.svg';
import { ReactComponent as LinkIcon } from '@/assets/icons/link.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as DocumentIcon } from '@/assets/icons/page.svg';
import { ReactComponent as ReminderIcon } from '@/assets/icons/reminder_clock.svg';
import { calculateOptimalOrigins, Popover } from '@/components/_shared/popover';
import { usePanelContext } from '@/components/editor/components/panels/Panels.hooks';
import { PanelType } from '@/components/editor/components/panels/PanelsContext';
import { useEditorContext } from '@/components/editor/EditorContext';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';

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
const MENTION_SEARCH_CACHE_LIMIT = 50;
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
    };

interface MentionPanelResultSection {
  section: MentionSearchSection;
  options: MentionPanelOption[];
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

function MentionSectionTitle({ section }: { section: MentionSearchSection }) {
  return (
    <div className={'flex min-h-7 items-center px-0 text-sm font-semibold text-text-tertiary'}>
      <span className={'truncate'}>{section.title}</span>
    </div>
  );
}

export function MentionPanel() {
  const { isPanelOpen, panelPosition, closePanel, searchText, removeContent, activePanel } = usePanelContext();
  const { workspaceId, viewId, searchMentions, mentionContext, loadViewMeta } = useEditorContext();
  const { t } = useTranslation();
  const ref = useRef<HTMLDivElement>(null);
  const open = useMemo(() => {
    return isPanelOpen(PanelType.Mention) || isPanelOpen(PanelType.PageReference);
  }, [isPanelOpen]);
  const selectedOptionRef = useRef<Option | null>(null);
  const [selectedOption, setSelectedOption] = useState<Option | null>(null);
  const editor = useSlateStatic() as YjsEditor;
  const [mentionSections, setMentionSections] = useState<MentionSearchSection[]>([]);
  const [mentionSearchLoading, setMentionSearchLoading] = useState(false);
  const [mentionSearchFailed, setMentionSearchFailed] = useState(false);
  const [showMorePages, setShowMorePages] = useState(false);
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
  const mentionSearchRequests = useMemo(() => buildMentionSearchRequests(mentionSearchRequest), [mentionSearchRequest]);
  const mentionSearchCacheKey = useMemo(
    () => buildMentionSearchRequestsCacheKey(mentionSearchRequests),
    [mentionSearchRequests]
  );
  const pickerMentionSections = useMemo(
    () => normalizeMentionSearchSectionsForPicker(mentionSections),
    [mentionSections]
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

            const initialSections = mergeMentionSearchResponses(responses).sections ?? [];
            let sections = initialSections;
            const shouldCacheInitialSections = shouldCacheMentionSearchSections(
              mentionSearchRequests,
              initialSections,
              hasMentionSearchQuery
            );

            setMentionSections(initialSections);
            setMentionSearchFailed(false);

            if (!shouldCacheInitialSections) {
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

            if (sections !== initialSections) {
              setMentionSections(sections);
            }

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

  const rawMentionSearchResults = useMemo(
    () =>
      flattenMentionSearchSections(pickerMentionSections).filter(
        (result) => hasMentionSearchQuery || result.item.kind !== MentionTargetKind.DatabaseRow
      ),
    [hasMentionSearchQuery, pickerMentionSections]
  );
  const { mentionResultSections, mentionPanelOptions } = useMemo(() => {
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
        const sectionOptions: MentionPanelOption[] = visibleResults.map((result) => ({
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

    return {
      mentionResultSections: sections,
      mentionPanelOptions: options,
    };
  }, [pickerMentionSections, rawMentionSearchResults, showMorePages]);
  const mentionOptionIndexByKey = useMemo(() => {
    return new Map(mentionPanelOptions.map((option, index) => [option.key, index]));
  }, [mentionPanelOptions]);

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
            }
          }

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
  }, [editor, handleSelectedSearchResult, mentionPanelOptions, open, selectedOptionRef]);
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
      >
        {searchMentions && (
          <div data-option-category={MentionTag.Result} className={'flex flex-col'}>
            {mentionResultSections.map(({ section, options }, sectionResultIndex) => (
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
            ))}
            {!mentionSearchLoading && rawMentionSearchResults.length === 0 && (searchText || mentionSearchFailed) && (
              <div className={'flex items-center justify-center p-2 text-sm text-text-secondary'}>
                {t('findAndReplace.noResult')}
              </div>
            )}
          </div>
        )}
      </div>
    </Popover>
  );
}

export default MentionPanel;
