import { Button } from '@mui/material';
import { PopoverOrigin } from '@mui/material/Popover/Popover';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Editor, Element, Transforms } from 'slate';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { isEmbedBlockTypes } from '@/application/slate-yjs/command/const';
import {
  findSlateEntryByBlockId,
  getBlockEntry,
  isInsideSimpleTableCell as isBlockInsideSimpleTableCell,
} from '@/application/slate-yjs/utils/editor';
import { getBlockIndex, getParent } from '@/application/slate-yjs/utils/yjs';
import {
  AlignType,
  AudioBlockData,
  AudioUrlType,
  BlockData,
  BlockType,
  CalloutBlockData,
  CodeBlockData,
  GalleryBlockData,
  GalleryLayout,
  GoogleDriveBlockData,
  HeadingBlockData,
  ImageBlockData,
  LinkPreviewBlockData,
  LinkPreviewType,
  SubpageNodeData,
  ToggleListBlockData,
  VideoBlockData,
  View,
  ViewLayout,
  YjsEditorKey,
} from '@/application/types';
// import { ReactComponent as AIWriterIcon } from '@/assets/slash_menu_icon_ai_writer.svg';
import { ReactComponent as EmojiIcon } from '@/assets/icons/add_emoji.svg';
import { ReactComponent as AddPageIcon } from '@/assets/icons/add_to_page.svg';
import { ReactComponent as AskAIIcon } from '@/assets/icons/ai.svg';
import { ReactComponent as AudioIcon } from '@/assets/icons/audio.svg';
import { ReactComponent as BoardIcon } from '@/assets/icons/board.svg';
import { ReactComponent as BulletedListIcon } from '@/assets/icons/bulleted_list.svg';
import { ReactComponent as CalendarIcon } from '@/assets/icons/calendar.svg';
import { ReactComponent as CalloutIcon } from '@/assets/icons/callout.svg';
import { ReactComponent as ChartIcon } from '@/assets/icons/chart.svg';
import { ReactComponent as ContinueWritingIcon } from '@/assets/icons/continue_writing.svg';
import { ReactComponent as DateIcon } from '@/assets/icons/date.svg';
import { ReactComponent as DividerIcon } from '@/assets/icons/divider.svg';
import { ReactComponent as OutlineIcon } from '@/assets/icons/doc.svg';
import { ReactComponent as FileIcon } from '@/assets/icons/file.svg';
import { ReactComponent as FormulaIcon } from '@/assets/icons/formula.svg';
import { ReactComponent as GalleryIcon } from '@/assets/icons/gallery.svg';
import { ReactComponent as GridIcon } from '@/assets/icons/grid.svg';
import { ReactComponent as SimpleTableIcon } from '@/assets/icons/table.svg';
import { ReactComponent as Heading1Icon } from '@/assets/icons/h1.svg';
import { ReactComponent as Heading2Icon } from '@/assets/icons/h2.svg';
import { ReactComponent as Heading3Icon } from '@/assets/icons/h3.svg';
import { ReactComponent as ImageIcon } from '@/assets/icons/image.svg';
import { ReactComponent as CodeIcon } from '@/assets/icons/inline_code.svg';
import { ReactComponent as LinkIcon } from '@/assets/icons/link.svg';
import { ReactComponent as NumberedListIcon } from '@/assets/icons/numbered_list.svg';
import { ReactComponent as DocumentIcon } from '@/assets/icons/page.svg';
import { ReactComponent as PDFIcon } from '@/assets/icons/pdf.svg';
import { ReactComponent as QuoteIcon } from '@/assets/icons/quote.svg';
import { ReactComponent as RefDocumentIcon } from '@/assets/icons/ref_page.svg';
import { ReactComponent as TextIcon } from '@/assets/icons/text.svg';
import { ReactComponent as TodoListIcon } from '@/assets/icons/todo.svg';
import { ReactComponent as ToggleHeading1Icon } from '@/assets/icons/toggle_h1.svg';
import { ReactComponent as ToggleHeading2Icon } from '@/assets/icons/toggle_h2.svg';
import { ReactComponent as ToggleHeading3Icon } from '@/assets/icons/toggle_h3.svg';
import { ReactComponent as ChevronRight, ReactComponent as ToggleListIcon } from '@/assets/icons/toggle_list.svg';
import { ReactComponent as VideoIcon } from '@/assets/icons/video.svg';
import { ReactComponent as GoogleIcon } from '@/assets/login/google.svg';
import { notify } from '@/components/_shared/notify';
import { calculateOptimalOrigins, Popover } from '@/components/_shared/popover';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { useAIEnabled } from '@/components/app/app.hooks';
import { useAIWriter } from '@/components/chat';
import { SearchInput } from '@/components/chat/components/ui/search-input';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { createDatabaseNodeData } from '@/components/editor/components/blocks/database/utils/databaseBlockUtils';
import { usePanelContext } from '@/components/editor/components/panels/Panels.hooks';
import { PanelType } from '@/components/editor/components/panels/PanelsContext';
import { getRangeRect } from '@/components/editor/components/toolbar/selection-toolbar/utils';
import { useEditorContext } from '@/components/editor/EditorContext';
import { Button as OutlineButton } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Separator } from '@/components/ui/separator';
import { Log } from '@/utils/log';
import { getCharacters } from '@/utils/word';
import {
  filterSlashMenuOptions,
  groupSlashMenuOptions,
  SlashMenuGroupKey,
  SlashMenuOptionBase,
} from './slash-menu-options';

type DatabaseOption = {
  databaseId: string;
  view: View;
};

interface SlashMenuOption extends SlashMenuOptionBase {
  icon: React.ReactNode;
  onClick?: () => void;
}

const AI_MEETING_BLOCK_TYPES = new Set<BlockType>([
  BlockType.AIMeetingBlock,
  BlockType.AIMeetingSummaryBlock,
  BlockType.AIMeetingNotesBlock,
  BlockType.AIMeetingTranscriptionBlock,
  BlockType.AIMeetingSpeakerBlock,
]);

function filterViewsByDatabases(views: View[], allowedIds: Set<string>, keyword: string) {
  const lowercaseKeyword = keyword.toLowerCase();

  const filter = (items: View[]): View[] => {
    return items
      .map((item) => {
        const children = filter(item.children || []);
        const matchKeyword = !keyword || item.name?.toLowerCase().includes(lowercaseKeyword);
        const includeSelf = allowedIds.has(item.view_id) && matchKeyword;
        const shouldKeep = includeSelf || children.length > 0;

        if (!shouldKeep) return null;

        return {
          ...item,
          children,
        };
      })
      .filter(Boolean) as View[];
  };

  return filter(views);
}

const DatabaseTreeItem: React.FC<{
  view: View;
  allowedIds: Set<string>;
  onSelect: (view: View) => void;
  fallbackTitle: string;
  isSearching?: boolean;
}> = ({ view, allowedIds, onSelect, fallbackTitle, isSearching }) => {
  const [expanded, setExpanded] = useState(view.extra?.is_space || false);
  // Auto-expand all nodes when searching so filtered results are visible
  const effectiveExpanded = isSearching ? true : expanded;
  const isDatabase = allowedIds.has(view.view_id);
  const hasChildren = view.children?.length > 0;
  const name = view.name || fallbackTitle;

  return (
    <div className={'flex flex-col'}>
      <div
        onClick={() => {
          if (!hasChildren) {
            if (isDatabase) onSelect(view);
            return;
          }

          if (isDatabase) {
            onSelect(view);
          }

          if (!isSearching) {
            setExpanded((prev) => !prev);
          }
        }}
        className={
          'flex h-[28px] w-full cursor-pointer select-none items-center justify-between gap-2 rounded-[8px] px-1.5 text-sm hover:bg-muted'
        }
      >
        <div className={'flex w-full items-center gap-2 overflow-hidden'}>
          {hasChildren ? (
            <OutlineButton
              variant={'ghost'}
              className={'!h-4 !min-h-4 !w-4 !min-w-4 !p-0 hover:bg-muted-foreground/10'}
              onClick={(e) => {
                e.stopPropagation();
                if (!isSearching) {
                  setExpanded((prev) => !prev);
                }
              }}
            >
              <ChevronRight
                className={`transform transition-transform ${effectiveExpanded ? 'rotate-90' : 'rotate-0'}`}
              />
            </OutlineButton>
          ) : (
            <div style={{ width: 16, height: 16 }} />
          )}
          <PageIcon view={view} className={'flex h-5 w-5 min-w-5 items-center justify-center'} />
          <span className={'flex-1 truncate'}>{name}</span>
        </div>
        {isDatabase && (
          <div
            onClick={(e) => {
              e.stopPropagation();
              onSelect(view);
            }}
          >
            <OutlineButton variant={'ghost'} className={'!h-5 !w-5 rounded-md !p-0 hover:bg-muted-foreground/10'}>
              <AddPageIcon className={'h-5 w-5'} />
            </OutlineButton>
          </div>
        )}
      </div>
      {hasChildren && effectiveExpanded && (
        <div className={'flex flex-col gap-1 pl-4'}>
          {view.children?.map((child) => (
            <DatabaseTreeItem
              key={child.view_id}
              view={child}
              allowedIds={allowedIds}
              onSelect={onSelect}
              fallbackTitle={fallbackTitle}
              isSearching={isSearching}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export function SlashPanel({
  setEmojiPosition,
}: {
  setEmojiPosition: (position: { top: number; left: number }) => void;
}) {
  const { isPanelOpen, panelPosition, closePanel, searchText, removeContent, openPanel } = usePanelContext();
  const {
    addPage,
    openPageModal,
    viewId: documentId,
    loadViewMeta,
    getMoreAIContext,
    createDatabaseView,
    loadViews,
    loadDatabaseRelations,
  } = useEditorContext();
  const [viewName, setViewName] = useState('');
  const [linkedPicker, setLinkedPicker] = useState<{
    position: { top: number; left: number };
    layout: ViewLayout;
  } | null>(null);
  const [linkedTransformOrigin, setLinkedTransformOrigin] = useState<PopoverOrigin | undefined>(undefined);
  const [databaseSearch, setDatabaseSearch] = useState('');
  const [databaseOutline, setDatabaseOutline] = useState<View[]>([]);
  const [databaseOptions, setDatabaseOptions] = useState<DatabaseOption[]>([]);
  const [databaseLoading, setDatabaseLoading] = useState(false);
  const [databaseError, setDatabaseError] = useState<string | null>(null);

  const editor = useSlateStatic() as YjsEditor;

  const { t } = useTranslation();
  const optionsRef = useRef<HTMLDivElement>(null);
  const [selectedOption, setSelectedOption] = React.useState<string | null>(null);
  const [transformOrigin, setTransformOrigin] = React.useState<PopoverOrigin | undefined>(undefined);
  const selectedOptionRef = React.useRef<string | null>(null);
  const { openPopover } = usePopoverContext();

  const open = useMemo(() => {
    return isPanelOpen(PanelType.Slash);
  }, [isPanelOpen]);

  const getIsInsideAIMeeting = useCallback(() => {
    const { selection } = editor;

    if (!selection) return false;

    try {
      const inAIMeeting = Editor.above(editor, {
        at: selection,
        match: (n) => !Editor.isEditor(n) && Element.isElement(n) && AI_MEETING_BLOCK_TYPES.has(n.type as BlockType),
      });

      return Boolean(inAIMeeting);
    } catch {
      return false;
    }
  }, [editor]);

  const getIsInsideSimpleTableCell = useCallback(() => {
    try {
      const block = getBlockEntry(editor);
      const blockId = block?.[0].blockId;

      if (blockId && isBlockInsideSimpleTableCell(editor, blockId)) return true;
    } catch {
      // Fall back to the ancestor lookup below; selections can briefly point at stale paths while the panel opens.
    }

    try {
      const inSimpleTableCell = Editor.above(editor, {
        match: (n) => !Editor.isEditor(n) && Element.isElement(n) && n.type === BlockType.SimpleTableCellBlock,
      });

      return Boolean(inSimpleTableCell);
    } catch {
      return false;
    }
  }, [editor]);

  useEffect(() => {
    if (documentId && open) {
      void loadViewMeta?.(documentId).then((view) => {
        if (view) {
          setViewName(view.name);
        }
      });
    }
  }, [documentId, loadViewMeta, open]);

  const getBeforeContent = useCallback(() => {
    const { selection } = editor;

    if (!selection) return '';

    const start = {
      path: [0],
      offset: 0,
    };

    const end = editor.end(selection);

    const moreContext = getMoreAIContext?.();

    return (
      viewName +
      '\n' +
      (moreContext ? `More context: ${moreContext} \n` : '') +
      CustomEditor.getSelectionContent(editor, {
        anchor: start,
        focus: end,
      })
    );
  }, [editor, viewName, getMoreAIContext]);

  const chars = useMemo(() => {
    if (!open) return 0;

    return getCharacters(getBeforeContent());
  }, [open, getBeforeContent]);

  const blockTypeByLayout = useCallback((layout: ViewLayout) => {
    switch (layout) {
      case ViewLayout.Grid:
        return BlockType.GridBlock;
      case ViewLayout.Board:
        return BlockType.BoardBlock;
      case ViewLayout.Calendar:
        return BlockType.CalendarBlock;
      case ViewLayout.Chart:
        return BlockType.ChartBlock;
      default:
        return null;
    }
  }, []);

  const handleSelectOption = useCallback(
    (option: string) => {
      setSelectedOption(option);
      removeContent();
      closePanel();
      editor.flushLocalChanges();
    },
    [closePanel, removeContent, editor]
  );

  const turnInto = useCallback(
    (type: BlockType, data: BlockData) => {
      const block = getBlockEntry(editor);

      if (!block) return;

      const blockId = block[0].blockId as string;
      const isEmpty = !CustomEditor.getBlockTextContent(block[0], 2);
      let newBlockId: string | undefined;

      if (isEmpty) {
        newBlockId = CustomEditor.turnToBlock(editor, blockId, type, data);
      } else {
        newBlockId = CustomEditor.addBelowBlock(editor, blockId, type, data);
      }

      if (newBlockId && isEmbedBlockTypes(type)) {
        // Skip selection for database blocks as they open in a modal
        // and don't need cursor positioning. Explicitly deselect to prevent Slate from scrolling.
        const isDatabaseBlock = [
          BlockType.GridBlock,
          BlockType.BoardBlock,
          BlockType.CalendarBlock,
          BlockType.ChartBlock,
        ].includes(type);

        if (isDatabaseBlock) {
          Transforms.deselect(editor);
        } else {
          const entry = findSlateEntryByBlockId(editor, newBlockId);

          if (!entry) return;

          const [, path] = entry;

          editor.select(editor.start(path));
        }
      }

      if (
        [
          BlockType.FileBlock,
          BlockType.AudioBlock,
          BlockType.ImageBlock,
          BlockType.LinkPreview,
          BlockType.GalleryBlock,
          BlockType.GoogleDriveBlock,
          BlockType.EquationBlock,
          BlockType.VideoBlock,
          BlockType.PDFBlock,
        ].includes(type)
      ) {
        setTimeout(() => {
          if (!newBlockId) return;
          const entry = findSlateEntryByBlockId(editor, newBlockId);

          if (!entry) return;
          const [node] = entry;
          const dom = ReactEditor.toDOMNode(editor, node);

          openPopover(newBlockId, type, dom);
        }, 50);
      }
    },
    [editor, openPopover]
  );

  const allowedDatabaseIds = useMemo(() => {
    return new Set(databaseOptions.map((option) => option.view.view_id));
  }, [databaseOptions]);

  const filteredDatabaseTree = useMemo(() => {
    if (!databaseOutline.length) return [];
    return filterViewsByDatabases(databaseOutline, allowedDatabaseIds, databaseSearch);
  }, [databaseOutline, allowedDatabaseIds, databaseSearch]);

  const { askAIAnything, continueWriting } = useAIWriter();
  const aiEnabled = useAIEnabled();

  const loadDatabasesForPicker = useCallback(async () => {
    if (!loadViews) return false;
    setDatabaseLoading(true);
    setDatabaseError(null);

    try {
      const views = (await loadViews()) || [];

      setDatabaseOutline(views);

      // Collect selectable database IDs by walking the tree structure.
      // This preserves parent-child relationships so we can distinguish between:
      // 1. Database containers (v0.10.7+) - always selectable
      // 2. Legacy top-level databases (pre-v0.10.7) - selectable
      // 3. Child views of containers/databases - NOT selectable (hidden)
      const databaseLayouts = new Set([ViewLayout.Grid, ViewLayout.Board, ViewLayout.Calendar, ViewLayout.Chart]);
      const selectableDatabaseViews: View[] = [];

      const collectSelectable = (items: View[], parentIsDatabase: boolean) => {
        for (const view of items) {
          if (databaseLayouts.has(view.layout)) {
            if (view.extra?.is_database_container) {
              // Case 1: Database container - always selectable
              selectableDatabaseViews.push(view);
              collectSelectable(view.children || [], true);
            } else if (!parentIsDatabase && !view.extra?.embedded) {
              // Case 2: Legacy top-level database (not a child of another database,
              // not embedded in a document). These were created before the container
              // system and should still be linkable via the slash menu.
              selectableDatabaseViews.push(view);
              collectSelectable(view.children || [], true);
            } else {
              // Case 3: Child view of a database or embedded view - not selectable
              collectSelectable(view.children || [], parentIsDatabase);
            }
          } else {
            // Non-database view (document, space, etc.) - recurse into children
            collectSelectable(view.children || [], parentIsDatabase);
          }
        }
      };

      collectSelectable(views, false);

      // Build options - databaseId will be fetched from viewMeta when user selects
      // The outline API doesn't include database_relations, so we set empty string here
      const options: DatabaseOption[] = selectableDatabaseViews.map((view) => ({
        databaseId: '', // Will be fetched from loadViewMeta in handleSelectDatabase
        view,
      }));

      Log.debug('[SlashPanel] loadDatabasesForPicker:', {
        databaseViews: selectableDatabaseViews.length,
        databaseViewNames: selectableDatabaseViews.map((v) => v.name),
      });

      setDatabaseOptions(options);
      return options.length > 0;
    } catch (e) {
      const error = e as Error;

      notify.error(error.message);
      setDatabaseError(error.message);
      setDatabaseOutline([]);
      setDatabaseOptions([]);
      return false;
    } finally {
      setDatabaseLoading(false);
    }
  }, [loadViews]);

  const handleOpenLinkedDatabasePicker = useCallback(
    async (layout: ViewLayout, optionKey: string) => {
      if (!documentId || !createDatabaseView) return;
      const rect = getRangeRect();

      if (!rect) return;

      handleSelectOption(optionKey);
      setDatabaseSearch('');
      const hasDatabases = await loadDatabasesForPicker();

      if (!hasDatabases) {
        notify.error(
          t('document.slashMenu.linkedDatabase.empty', {
            defaultValue: 'No databases available to link',
          })
        );
        setLinkedPicker(null);
        return;
      }

      setLinkedPicker({
        position: {
          top: rect.top,
          left: rect.left,
        },
        layout,
      });
    },
    [createDatabaseView, handleSelectOption, loadDatabasesForPicker, t, documentId]
  );

  const handleSelectDatabase = useCallback(
    async (targetViewId: string) => {
      if (!linkedPicker) return;

      if (!createDatabaseView || !documentId) {
        notify.error(
          t('document.slashMenu.linkedDatabase.actionUnavailable', {
            defaultValue: 'Linking databases is not available right now',
          })
        );
        return;
      }

      const option = databaseOptions.find((item) => item.view.view_id === targetViewId);
      const blockType = blockTypeByLayout(linkedPicker.layout);

      if (!option || !blockType) {
        setLinkedPicker(null);
        return;
      }

      try {
        const databaseViewId = option.view.view_id;
        const baseName = option.view.name || t('document.view.placeholder', { defaultValue: 'Untitled' });

        // Database ID is available on database containers and database views via `extra.database_id`.
        // Prefer the outline value, then fallback to view meta / legacy database_relations mapping.
        let databaseId = option.view.extra?.database_id;
        let viewMeta: View | null = null;

        if (!databaseId) {
          if (!loadViewMeta) {
            notify.error(
              t('document.slashMenu.linkedDatabase.actionUnavailable', {
                defaultValue: 'Unable to fetch database information',
              })
            );
            return;
          }

          viewMeta = await loadViewMeta(databaseViewId);
          databaseId = viewMeta?.extra?.database_id;
        }

        if (!databaseId && viewMeta?.database_relations) {
          // database_relations is Record<DatabaseId, ViewId>
          // Find the entry where the value (base view id) matches this view
          let relationEntry = Object.entries(viewMeta.database_relations).find(
            ([_, baseViewId]) => baseViewId === databaseViewId
          );

          // If not found, try refreshing database relations (for newly created databases)
          if (!relationEntry && loadDatabaseRelations) {
            Log.debug('[SlashPanel] database_id not found in cache, refreshing relations...', {
              viewId: databaseViewId,
            });

            // Refresh and get fresh relations directly (don't rely on React state update)
            const freshRelations = await loadDatabaseRelations();

            Log.debug('[SlashPanel] Fresh relations after refresh:', {
              viewId: databaseViewId,
              freshRelations,
            });

            if (freshRelations) {
              relationEntry = Object.entries(freshRelations).find(([_, baseViewId]) => baseViewId === databaseViewId);
            }
          }

          if (relationEntry) {
            databaseId = relationEntry[0];
          }
        }

        Log.debug('[SlashPanel] resolved database_id:', {
          targetViewId: databaseViewId,
          databaseId,
          fromOutlineExtra: Boolean(option.view.extra?.database_id),
          fromViewMetaExtra: Boolean(viewMeta?.extra?.database_id),
          hasDatabaseRelations: Boolean(viewMeta?.database_relations),
        });

        if (!databaseId) {
          notify.error(
            t('document.slashMenu.linkedDatabase.actionUnavailable', {
              defaultValue: 'Could not find database ID',
            })
          );
          return;
        }

        Log.debug('[SlashPanel] Found database_id:', {
          viewId: databaseViewId,
          databaseId,
        });

        const prefix = (() => {
          switch (linkedPicker.layout) {
            case ViewLayout.Grid:
              return t('document.grid.referencedGridPrefix', {
                defaultValue: 'View of',
              });
            case ViewLayout.Board:
              return t('document.board.referencedBoardPrefix', {
                defaultValue: 'View of',
              });
            case ViewLayout.Calendar:
              return t('document.calendar.referencedCalendarPrefix', {
                defaultValue: 'View of',
              });
            case ViewLayout.Chart:
              return t('document.chart.referencedChartPrefix', {
                defaultValue: 'View of',
              });
            default:
              return '';
          }
        })();
        const referencedName = prefix ? `${prefix} ${baseName}` : baseName;

        const response = await createDatabaseView(documentId, {
          parent_view_id: documentId,
          database_id: databaseId,
          layout: linkedPicker.layout,
          name: referencedName,
          embedded: true,
        });

        Log.debug('[SlashPanel] {} created linked database', {
          documentId,
          databaseViewId,
          newViewId: response.view_id,
          referencedName,
        });

        turnInto(
          blockType,
          createDatabaseNodeData({
            parentId: documentId,
            viewIds: [response.view_id],
            databaseId: response.database_id,
          })
        );
      } catch (e) {
        const error = e as Error;

        notify.error(error.message);
      } finally {
        setLinkedPicker(null);
      }
    },
    [
      linkedPicker,
      createDatabaseView,
      documentId,
      databaseOptions,
      blockTypeByLayout,
      turnInto,
      t,
      loadViewMeta,
      loadDatabaseRelations,
    ]
  );

  const groupLabels = useMemo<Record<SlashMenuGroupKey, string>>(
    () => ({
      [SlashMenuGroupKey.AppFlowyAI]: t('document.slashMenu.group.appflowyAI', { defaultValue: 'AppFlowy AI' }),
      [SlashMenuGroupKey.BasicBlocks]: t('document.slashMenu.group.basicBlocks', { defaultValue: 'Basic blocks' }),
      [SlashMenuGroupKey.Media]: t('document.slashMenu.group.media', { defaultValue: 'Media' }),
      [SlashMenuGroupKey.Database]: t('document.slashMenu.group.database', { defaultValue: 'Database' }),
      [SlashMenuGroupKey.AdvancedBlocks]: t('document.slashMenu.group.advancedBlocks', {
        defaultValue: 'Advanced blocks',
      }),
      [SlashMenuGroupKey.Inline]: t('document.slashMenu.group.inline', { defaultValue: 'Inline' }),
    }),
    [t]
  );

  const options: SlashMenuOption[] = useMemo(() => {
    const isInsideSimpleTableCell = getIsInsideSimpleTableCell();
    const isInsideAIMeeting = getIsInsideAIMeeting();

    const allOptions: SlashMenuOption[] = [
      ...(aiEnabled
        ? [
            {
              label: t('document.slashMenu.name.askAIAnything'),
              key: 'askAIAnything',
              icon: <AskAIIcon />,
              group: SlashMenuGroupKey.AppFlowyAI,
              keywords: ['ai', 'writer', 'ask', 'anything', 'askAIAnything', 'askai'],
              onClick: () => {
                const content = getBeforeContent();

                askAIAnything(content);
              },
            },
            {
              label: t('document.slashMenu.name.continueWriting'),
              key: 'continueWriting',
              disabled: chars < 2,
              icon: <ContinueWritingIcon />,
              group: SlashMenuGroupKey.AppFlowyAI,
              keywords: ['ai', 'writing', 'continue'],
              onClick: () => {
                const content = getBeforeContent();

                void continueWriting(content);
              },
            },
          ]
        : []),
      {
        label: t('document.slashMenu.name.text'),
        key: 'text',
        icon: <TextIcon />,
        group: SlashMenuGroupKey.BasicBlocks,
        onClick: () => {
          turnInto(BlockType.Paragraph, {});
        },
        keywords: ['text', 'paragraph'],
      },
      {
        label: t('document.slashMenu.name.heading1'),
        key: 'heading1',
        icon: <Heading1Icon />,
        group: SlashMenuGroupKey.BasicBlocks,
        keywords: ['heading1', 'h1', 'heading', 'heading 1'],
        shortcut: '#',
        onClick: () => {
          turnInto(BlockType.HeadingBlock, {
            level: 1,
          } as HeadingBlockData);
        },
      },
      {
        label: t('document.slashMenu.name.heading2'),
        key: 'heading2',
        icon: <Heading2Icon />,
        group: SlashMenuGroupKey.BasicBlocks,
        keywords: ['heading2', 'h2', 'subheading', 'heading', 'heading 2'],
        shortcut: '##',
        onClick: () => {
          turnInto(BlockType.HeadingBlock, {
            level: 2,
          } as HeadingBlockData);
        },
      },
      {
        label: t('document.slashMenu.name.heading3'),
        key: 'heading3',
        icon: <Heading3Icon />,
        group: SlashMenuGroupKey.BasicBlocks,
        keywords: ['heading3', 'h3', 'subheading', 'heading', 'heading 3'],
        shortcut: '###',
        onClick: () => {
          turnInto(BlockType.HeadingBlock, {
            level: 3,
          } as HeadingBlockData);
        },
      },
      {
        label: t('document.slashMenu.name.image'),
        key: 'image',
        icon: <ImageIcon />,
        group: SlashMenuGroupKey.Media,
        keywords: ['image', 'img', 'photo', 'picture'],
        onClick: () => {
          turnInto(BlockType.ImageBlock, {
            url: '',
            align: AlignType.Center,
          } as ImageBlockData);
        },
      },
      {
        label: t('document.slashMenu.name.photoGallery', { defaultValue: 'Photo gallery' }),
        key: 'photoGallery',
        icon: <GalleryIcon />,
        group: SlashMenuGroupKey.Media,
        keywords: ['photo', 'gallery', 'image gallery', 'photo gallery', 'browser'],
        onClick: () => {
          turnInto(BlockType.GalleryBlock, {
            images: [],
            layout: GalleryLayout.Carousel,
          } as GalleryBlockData);
        },
      },
      {
        label: t('embedVideo'),
        key: 'video',
        icon: <VideoIcon />,
        group: SlashMenuGroupKey.Media,
        keywords: ['video', 'youtube', 'embed'],
        onClick: () => {
          turnInto(BlockType.VideoBlock, {
            url: '',
            align: AlignType.Center,
          } as VideoBlockData);
        },
      },
      {
        label: t('document.slashMenu.name.audio', { defaultValue: 'Audio' }),
        key: 'audio',
        icon: <AudioIcon />,
        group: SlashMenuGroupKey.Media,
        keywords: ['audio', 'music', 'sound', 'media'],
        onClick: () => {
          turnInto(BlockType.AudioBlock, {
            url: '',
            url_type: AudioUrlType.Network,
          } as AudioBlockData);
        },
      },
      {
        label: t('document.slashMenu.name.pdf', { defaultValue: 'PDF' }),
        key: 'pdf',
        icon: <PDFIcon />,
        group: SlashMenuGroupKey.Media,
        keywords: ['pdf', 'file', 'document', 'embed'],
        onClick: () => {
          turnInto(BlockType.PDFBlock, {});
        },
      },
      {
        label: t('document.slashMenu.name.googleDrive', { defaultValue: 'Google Drive' }),
        key: 'googleDrive',
        icon: <GoogleIcon />,
        group: SlashMenuGroupKey.Media,
        keywords: ['drive', 'google drive', 'google', 'docs', 'sheets', 'slides'],
        onClick: () => {
          turnInto(BlockType.GoogleDriveBlock, {
            url: '',
            uploaded_at: Date.now(),
            width_factor: 1,
            height_factor: 1,
          } as GoogleDriveBlockData);
        },
      },
      {
        label: t('document.slashMenu.name.bookmark', { defaultValue: 'Web bookmark' }),
        key: 'bookmark',
        icon: <LinkIcon />,
        group: SlashMenuGroupKey.Media,
        keywords: ['bookmark', 'web bookmark', 'link card', 'url card', 'link', 'bm'],
        onClick: () => {
          turnInto(BlockType.LinkPreview, {
            url: '',
            preview_type: LinkPreviewType.Bookmark,
          } as LinkPreviewBlockData);
        },
      },
      {
        label: t('document.slashMenu.name.bulletedList'),
        key: 'bulletedList',
        icon: <BulletedListIcon />,
        group: SlashMenuGroupKey.BasicBlocks,
        keywords: ['bulleted', 'list', 'unordered', 'ul', 'bl'],
        shortcut: '-',
        onClick: () => {
          turnInto(BlockType.BulletedListBlock, {});
        },
      },
      {
        label: t('document.slashMenu.name.numberedList'),
        key: 'numberedList',
        icon: <NumberedListIcon />,
        group: SlashMenuGroupKey.BasicBlocks,
        keywords: ['numbered', 'list', 'ordered', 'ol', 'nl'],
        shortcut: '1.',
        onClick: () => {
          turnInto(BlockType.NumberedListBlock, {});
        },
      },
      {
        label: t('document.slashMenu.name.todoList'),
        key: 'todoList',
        icon: <TodoListIcon />,
        group: SlashMenuGroupKey.BasicBlocks,
        keywords: ['todo', 'to-do', 'list', 'checkbox', 'task'],
        shortcut: '[]',
        onClick: () => {
          turnInto(BlockType.TodoListBlock, {});
        },
      },
      {
        label: t('document.slashMenu.name.divider'),
        key: 'divider',
        icon: <DividerIcon />,
        group: SlashMenuGroupKey.BasicBlocks,
        keywords: ['divider', 'line', 'separator', 'break', 'horizontal line', 'hr'],
        shortcut: '---',
        onClick: () => {
          turnInto(BlockType.DividerBlock, {});
        },
      },
      {
        label: t('document.slashMenu.name.quote'),
        key: 'quote',
        icon: <QuoteIcon />,
        group: SlashMenuGroupKey.BasicBlocks,
        keywords: ['quote', 'refer', 'blockquote', 'citation'],
        shortcut: '"',
        onClick: () => {
          turnInto(BlockType.QuoteBlock, {});
        },
      },
      {
        label: t('document.slashMenu.name.linkedDoc'),
        key: 'linkedDoc',
        icon: <RefDocumentIcon />,
        group: SlashMenuGroupKey.BasicBlocks,
        keywords: ['linked', 'doc', 'page', 'document', 'reference'],
        aliases: ['link to page', 'link to doc', 'referenced page', 'referenced document', 'ltp', 'ltd', 'rp', 'rd'],
        onClick: () => {
          const rect = getRangeRect();

          if (!rect) return;
          openPanel(PanelType.PageReference, { top: rect.top, left: rect.left });
        },
      },
      {
        label: t('document.menuName'),
        key: 'document',
        icon: <DocumentIcon />,
        group: SlashMenuGroupKey.BasicBlocks,
        keywords: [
          'document',
          'doc',
          'page',
          'create',
          'add',
          'sub page',
          'child page',
          'insert page',
          'embed page',
          'new page',
        ],
        onClick: async () => {
          if (!documentId || !addPage || !openPageModal) return;
          try {
            const response = await addPage(documentId, {
              layout: ViewLayout.Document,
            });

            turnInto(BlockType.SubpageBlock, {
              view_id: response.view_id,
            } as SubpageNodeData);

            openPageModal(response.view_id);
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (e: any) {
            notify.error(e.message);
          }
        },
      },
      {
        label: t('document.slashMenu.name.grid'),
        key: 'grid',
        icon: <GridIcon />,
        group: SlashMenuGroupKey.Database,
        keywords: ['grid', 'table', 'database', 'data table'],
        onClick: async () => {
          if (!documentId || !addPage) return;

          let scrollContainer: HTMLElement | null = null;

          try {
            const domNode = ReactEditor.toDOMNode(editor, editor);

            scrollContainer = domNode.closest('.appflowy-scroll-container');
          } catch (e) {
            // Ignore
          }

          if (!scrollContainer) {
            scrollContainer = document.querySelector('.appflowy-scroll-container');
          }

          const savedScrollTop = scrollContainer?.scrollTop;

          try {
            const response = await addPage(documentId, {
              layout: ViewLayout.Grid,
              name: t('document.plugins.database.newDatabase'),
            });

            Log.debug('[SlashPanel] {} created grid', {
              documentId,
              databaseViewId: response.view_id,
            });

            turnInto(
              BlockType.GridBlock,
              createDatabaseNodeData({
                parentId: documentId,
                viewIds: [response.view_id],
                databaseId: response.database_id,
              })
            );

            openPageModal?.(response.view_id);

            if (savedScrollTop !== undefined) {
              const restoreScroll = () => {
                let currentContainer: HTMLElement | null = null;

                if (scrollContainer?.isConnected) {
                  currentContainer = scrollContainer;
                } else {
                  try {
                    const domNode = ReactEditor.toDOMNode(editor, editor);

                    currentContainer = domNode.closest('.appflowy-scroll-container');
                  } catch {
                    currentContainer = document.querySelector('.appflowy-scroll-container');
                  }
                }

                if (!currentContainer) return;
                if (Math.abs(currentContainer.scrollTop - savedScrollTop) <= 5) return;

                currentContainer.scrollTop = savedScrollTop;
              };

              requestAnimationFrame(restoreScroll);
              setTimeout(restoreScroll, 50);
              setTimeout(restoreScroll, 250);
              setTimeout(restoreScroll, 600);
              setTimeout(restoreScroll, 1200);
              setTimeout(restoreScroll, 1800);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (e: any) {
            notify.error(e.message);
          }
        },
      },
      {
        label: t('document.slashMenu.name.linkedGrid'),
        key: 'linkedGrid',
        icon: <GridIcon />,
        group: SlashMenuGroupKey.Database,
        keywords: ['linked', 'grid', 'table', 'database', 'data table'],
        aliases: ['link to grid', 'link to database', 'referenced grid', 'ltg'],
        onClick: () => {
          void handleOpenLinkedDatabasePicker(ViewLayout.Grid, 'linkedGrid');
        },
      },
      {
        label: t('document.slashMenu.name.kanban'),
        key: 'board',
        icon: <BoardIcon />,
        group: SlashMenuGroupKey.Database,
        keywords: ['board', 'kanban', 'database'],
        onClick: async () => {
          if (!documentId || !addPage) return;

          let scrollContainer: HTMLElement | null = null;

          try {
            const domNode = ReactEditor.toDOMNode(editor, editor);

            scrollContainer = domNode.closest('.appflowy-scroll-container');
          } catch (e) {
            // Ignore
          }

          if (!scrollContainer) {
            scrollContainer = document.querySelector('.appflowy-scroll-container');
          }

          const savedScrollTop = scrollContainer?.scrollTop;

          try {
            const response = await addPage(documentId, {
              layout: ViewLayout.Board,
              name: t('document.plugins.database.newDatabase'),
            });

            Log.debug('[SlashPanel] {} created kanban', {
              documentId,
              databaseViewId: response.view_id,
            });

            turnInto(
              BlockType.BoardBlock,
              createDatabaseNodeData({
                parentId: documentId,
                viewIds: [response.view_id],
                databaseId: response.database_id,
              })
            );

            openPageModal?.(response.view_id);

            if (savedScrollTop !== undefined) {
              const restoreScroll = () => {
                let currentContainer: HTMLElement | null = null;

                if (scrollContainer?.isConnected) {
                  currentContainer = scrollContainer;
                } else {
                  try {
                    const domNode = ReactEditor.toDOMNode(editor, editor);

                    currentContainer = domNode.closest('.appflowy-scroll-container');
                  } catch {
                    currentContainer = document.querySelector('.appflowy-scroll-container');
                  }
                }

                if (!currentContainer) return;
                if (Math.abs(currentContainer.scrollTop - savedScrollTop) <= 5) return;

                currentContainer.scrollTop = savedScrollTop;
              };

              requestAnimationFrame(restoreScroll);
              setTimeout(restoreScroll, 50);
              setTimeout(restoreScroll, 250);
              setTimeout(restoreScroll, 600);
              setTimeout(restoreScroll, 1200);
              setTimeout(restoreScroll, 1800);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (e: any) {
            notify.error(e.message);
          }
        },
      },
      {
        label: t('document.slashMenu.name.linkedKanban'),
        key: 'linkedKanban',
        icon: <BoardIcon />,
        group: SlashMenuGroupKey.Database,
        keywords: ['linked', 'kanban', 'board', 'database'],
        aliases: ['link to board', 'link to kanban', 'referenced board', 'ltb'],
        onClick: () => {
          void handleOpenLinkedDatabasePicker(ViewLayout.Board, 'linkedKanban');
        },
      },
      {
        label: t('document.slashMenu.name.calendar'),
        key: 'calendar',
        icon: <CalendarIcon />,
        group: SlashMenuGroupKey.Database,
        keywords: ['calendar', 'date', 'database'],
        onClick: async () => {
          if (!documentId || !addPage) return;

          let scrollContainer: HTMLElement | null = null;

          try {
            const domNode = ReactEditor.toDOMNode(editor, editor);

            scrollContainer = domNode.closest('.appflowy-scroll-container');
          } catch (e) {
            // Ignore
          }

          if (!scrollContainer) {
            scrollContainer = document.querySelector('.appflowy-scroll-container');
          }

          const savedScrollTop = scrollContainer?.scrollTop;

          try {
            const response = await addPage(documentId, {
              layout: ViewLayout.Calendar,
              name: t('document.plugins.database.newDatabase'),
            });

            Log.debug('[SlashPanel] {} created calendar', {
              documentId,
              databaseViewId: response.view_id,
            });

            turnInto(
              BlockType.CalendarBlock,
              createDatabaseNodeData({
                parentId: documentId,
                viewIds: [response.view_id],
                databaseId: response.database_id,
              })
            );

            openPageModal?.(response.view_id);

            if (savedScrollTop !== undefined) {
              const restoreScroll = () => {
                let currentContainer: HTMLElement | null = null;

                if (scrollContainer?.isConnected) {
                  currentContainer = scrollContainer;
                } else {
                  try {
                    const domNode = ReactEditor.toDOMNode(editor, editor);

                    currentContainer = domNode.closest('.appflowy-scroll-container');
                  } catch {
                    currentContainer = document.querySelector('.appflowy-scroll-container');
                  }
                }

                if (!currentContainer) return;
                if (Math.abs(currentContainer.scrollTop - savedScrollTop) <= 5) return;

                currentContainer.scrollTop = savedScrollTop;
              };

              requestAnimationFrame(restoreScroll);
              setTimeout(restoreScroll, 50);
              setTimeout(restoreScroll, 250);
              setTimeout(restoreScroll, 600);
              setTimeout(restoreScroll, 1200);
              setTimeout(restoreScroll, 1800);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (e: any) {
            notify.error(e.message);
          }
        },
      },
      {
        label: t('document.slashMenu.name.linkedCalendar'),
        key: 'linkedCalendar',
        icon: <CalendarIcon />,
        group: SlashMenuGroupKey.Database,
        keywords: ['linked', 'calendar', 'date', 'database'],
        aliases: ['link to calendar', 'referenced calendar', 'ltc'],
        onClick: () => {
          void handleOpenLinkedDatabasePicker(ViewLayout.Calendar, 'linkedCalendar');
        },
      },
      {
        label: t('document.slashMenu.name.chart', { defaultValue: 'Chart' }),
        key: 'chart',
        icon: <ChartIcon />,
        group: SlashMenuGroupKey.Database,
        keywords: ['chart', 'database', 'visualization'],
        onClick: async () => {
          if (!documentId || !addPage) return;

          let scrollContainer: HTMLElement | null = null;

          try {
            const domNode = ReactEditor.toDOMNode(editor, editor);

            scrollContainer = domNode.closest('.appflowy-scroll-container');
          } catch (e) {
            // Ignore
          }

          if (!scrollContainer) {
            scrollContainer = document.querySelector('.appflowy-scroll-container');
          }

          const savedScrollTop = scrollContainer?.scrollTop;

          try {
            const response = await addPage(documentId, {
              layout: ViewLayout.Chart,
              name: t('document.plugins.database.newDatabase'),
            });

            Log.debug('[SlashPanel] {} created chart', {
              documentId,
              databaseViewId: response.view_id,
            });

            turnInto(
              BlockType.ChartBlock,
              createDatabaseNodeData({
                parentId: documentId,
                viewIds: [response.view_id],
                databaseId: response.database_id,
              })
            );

            openPageModal?.(response.view_id);

            if (savedScrollTop !== undefined) {
              const restoreScroll = () => {
                let currentContainer: HTMLElement | null = null;

                if (scrollContainer?.isConnected) {
                  currentContainer = scrollContainer;
                } else {
                  try {
                    const domNode = ReactEditor.toDOMNode(editor, editor);

                    currentContainer = domNode.closest('.appflowy-scroll-container');
                  } catch {
                    currentContainer = document.querySelector('.appflowy-scroll-container');
                  }
                }

                if (!currentContainer) return;
                if (Math.abs(currentContainer.scrollTop - savedScrollTop) <= 5) return;

                currentContainer.scrollTop = savedScrollTop;
              };

              requestAnimationFrame(restoreScroll);
              setTimeout(restoreScroll, 50);
              setTimeout(restoreScroll, 250);
              setTimeout(restoreScroll, 600);
              setTimeout(restoreScroll, 1200);
              setTimeout(restoreScroll, 1800);
            }
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } catch (e: any) {
            notify.error(e.message);
          }
        },
      },
      {
        label: t('document.slashMenu.name.linkedChart', { defaultValue: 'Linked Chart' }),
        key: 'linkedChart',
        icon: <ChartIcon />,
        group: SlashMenuGroupKey.Database,
        keywords: ['linked', 'chart', 'database', 'visualization'],
        aliases: ['link to chart', 'referenced chart'],
        onClick: () => {
          void handleOpenLinkedDatabasePicker(ViewLayout.Chart, 'linkedChart');
        },
      },
      {
        label: t('document.slashMenu.name.table'),
        key: 'simpleTable',
        icon: <SimpleTableIcon />,
        group: SlashMenuGroupKey.BasicBlocks,
        keywords: ['table', 'simple table', 'rows', 'columns', 'data'],
        aliases: ['st'],
        onClick: () => {
          const block = getBlockEntry(editor);

          if (!block) return;

          const blockId = block[0].blockId as string;
          const isEmpty = !CustomEditor.getBlockTextContent(block[0], 2);

          // Find the parent block and insertion index BEFORE deleting
          const sharedRoot = editor.sharedRoot;
          const parentBlock = getParent(blockId, sharedRoot);

          if (!parentBlock) return;

          const parentBlockId = parentBlock.get(YjsEditorKey.block_id);
          const blockIndex = getBlockIndex(blockId, sharedRoot);

          if (isEmpty) {
            CustomEditor.deleteBlock(editor, blockId);
          }

          const insertIndex = isEmpty ? blockIndex : blockIndex + 1;
          const tableId = CustomEditor.createSimpleTable(editor, parentBlockId, 2, 2, insertIndex);

          if (tableId) {
            const selectTableStart = () => {
              try {
                const entry = findSlateEntryByBlockId(editor, tableId);

                if (!entry) return false;

                const point = Editor.start(editor, entry[1]);

                Transforms.select(editor, point);
                ReactEditor.focus(editor);
                return true;
              } catch {
                return false;
              }
            };

            if (!selectTableStart()) {
              requestAnimationFrame(() => {
                if (!selectTableStart()) {
                  setTimeout(selectTableStart, 50);
                }
              });
            }
          }
        },
      },
      {
        label: t('document.slashMenu.name.callout'),
        key: 'callout',
        icon: <CalloutIcon />,
        group: SlashMenuGroupKey.AdvancedBlocks,
        keywords: ['callout', 'note', 'tip'],
        onClick: () => {
          turnInto(BlockType.CalloutBlock, {
            icon: '📌',
          } as CalloutBlockData);
        },
      },
      {
        label: t('document.slashMenu.name.outline'),
        key: 'outline',
        icon: <OutlineIcon />,
        group: SlashMenuGroupKey.AdvancedBlocks,
        keywords: ['outline', 'table', 'contents', 'table of contents', 'toc', 'tableofcontents'],
        onClick: () => {
          turnInto(BlockType.OutlineBlock, {});
        },
      },
      {
        label: t('document.slashMenu.name.mathEquation'),
        key: 'math',
        icon: <FormulaIcon />,
        group: SlashMenuGroupKey.AdvancedBlocks,
        keywords: ['math', 'equation', 'formula', 'tex', 'latex', 'katex'],
        shortcut: '$$',
        onClick: () => {
          turnInto(BlockType.EquationBlock, {});
        },
      },
      {
        label: t('document.slashMenu.name.code'),
        key: 'code',
        icon: <CodeIcon />,
        group: SlashMenuGroupKey.AdvancedBlocks,
        keywords: ['code', 'block', 'codeblock', 'cb'],
        shortcut: '```',
        onClick: () => {
          turnInto(BlockType.CodeBlock, {});
        },
      },
      {
        label: t('document.slashMenu.name.mermaid', { defaultValue: 'Mermaid' }),
        key: 'mermaid',
        icon: <CodeIcon />,
        group: SlashMenuGroupKey.AdvancedBlocks,
        keywords: ['mermaid', 'diagram', 'chart'],
        onClick: () => {
          turnInto(BlockType.CodeBlock, {
            language: 'mermaid',
          } as CodeBlockData);
        },
      },
      {
        label: t('document.slashMenu.name.toggleList'),
        key: 'toggleList',
        icon: <ToggleListIcon />,
        group: SlashMenuGroupKey.BasicBlocks,
        keywords: ['toggle', 'list', 'collapsed list', 'dropdown', 'cl', 'tl'],
        shortcut: '>',
        onClick: () => {
          turnInto(BlockType.ToggleListBlock, {
            collapsed: false,
          } as ToggleListBlockData);
        },
      },
      {
        label: t('document.slashMenu.name.toggleHeading1'),
        key: 'toggleHeading1',
        icon: <ToggleHeading1Icon />,
        group: SlashMenuGroupKey.BasicBlocks,
        keywords: ['toggle', 'heading1', 'h1', 'heading', 'heading 1'],
        onClick: () => {
          turnInto(BlockType.ToggleListBlock, {
            collapsed: false,
            level: 1,
          } as ToggleListBlockData);
        },
      },
      {
        label: t('document.slashMenu.name.toggleHeading2'),
        key: 'toggleHeading2',
        icon: <ToggleHeading2Icon />,
        group: SlashMenuGroupKey.BasicBlocks,
        keywords: ['toggle', 'heading2', 'h2', 'subheading', 'heading', 'heading 2'],
        onClick: () => {
          turnInto(BlockType.ToggleListBlock, {
            collapsed: false,
            level: 2,
          } as ToggleListBlockData);
        },
      },
      {
        label: t('document.slashMenu.name.toggleHeading3'),
        key: 'toggleHeading3',
        icon: <ToggleHeading3Icon />,
        group: SlashMenuGroupKey.BasicBlocks,
        keywords: ['toggle', 'heading3', 'h3', 'subheading', 'heading', 'heading 3'],
        onClick: () => {
          turnInto(BlockType.ToggleListBlock, {
            collapsed: false,
            level: 3,
          } as ToggleListBlockData);
        },
      },
      {
        label: t('document.slashMenu.name.emoji'),
        key: 'emoji',
        icon: <EmojiIcon />,
        group: SlashMenuGroupKey.Inline,
        keywords: ['emoji', 'reaction'],
        onClick: () => {
          setTimeout(() => {
            const rect = getRangeRect();

            if (!rect) return;
            setEmojiPosition({
              top: rect.top,
              left: rect.left,
            });
          }, 50);
        },
      },
      {
        label: t('document.slashMenu.name.dateOrReminder'),
        key: 'dateOrReminder',
        icon: <DateIcon />,
        group: SlashMenuGroupKey.Inline,
        keywords: ['date', 'reminder', 'time', 'schedule'],
        onClick: () => {
          const rect = getRangeRect();

          if (!rect) return;
          openPanel(PanelType.Mention, { top: rect.top, left: rect.left });
        },
      },
      {
        label: t('document.slashMenu.name.file'),
        key: 'file',
        icon: <FileIcon />,
        group: SlashMenuGroupKey.Media,
        keywords: ['file', 'upload', 'attachment', 'pdf', 'video', 'audio', 'zip', 'archive'],
        onClick: () => {
          turnInto(BlockType.FileBlock, {});
        },
      },
    ];

    return filterSlashMenuOptions(allOptions, {
      searchText,
      isInsideSimpleTableCell,
      isInsideAIMeeting,
    });
  }, [
    t,
    chars,
    getBeforeContent,
    aiEnabled,
    askAIAnything,
    continueWriting,
    turnInto,
    openPanel,
    documentId,
    addPage,
    openPageModal,
    setEmojiPosition,
    searchText,
    handleOpenLinkedDatabasePicker,
    editor,
    getIsInsideAIMeeting,
    getIsInsideSimpleTableCell,
  ]);

  const optionGroups = useMemo(() => groupSlashMenuOptions(options), [options]);
  const orderedOptions = useMemo(() => optionGroups.flatMap(({ options }) => options), [optionGroups]);

  useEffect(() => {
    selectedOptionRef.current = selectedOption;
    if (!selectedOption) return;
    const el = optionsRef.current?.querySelector(`[data-option-key="${selectedOption}"]`) as HTMLButtonElement | null;

    // Scroll the option into view within the menu only, without affecting parent scroll containers
    if (el && optionsRef.current) {
      const menu = optionsRef.current;
      const elOffsetTop = el.offsetTop;
      const elHeight = el.offsetHeight;
      const menuScrollTop = menu.scrollTop;
      const menuHeight = menu.clientHeight;

      // Scroll the menu container (not the entire page) to show the selected option
      if (elOffsetTop < menuScrollTop) {
        // Element is above visible area
        menu.scrollTop = elOffsetTop;
      } else if (elOffsetTop + elHeight > menuScrollTop + menuHeight) {
        // Element is below visible area
        menu.scrollTop = elOffsetTop + elHeight - menuHeight;
      }
    }
  }, [selectedOption]);

  useEffect(() => {
    if (!open) return;

    setSelectedOption((current) => {
      if (orderedOptions.length === 0) return null;
      if (current && orderedOptions.some((option) => option.key === current)) return current;
      return orderedOptions[0].key;
    });
  }, [open, orderedOptions]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      const { key } = e;

      switch (key) {
        case 'Enter':
        case 'NumpadEnter': {
          e.stopPropagation();
          e.preventDefault();
          if (orderedOptions.length === 0) return;

          const item = orderedOptions.find((option) => option.key === selectedOptionRef.current) ?? orderedOptions[0];

          handleSelectOption(item.key);
          item.onClick?.();

          break;
        }

        case 'ArrowUp':
        case 'ArrowDown':
        case 'Tab': {
          e.stopPropagation();
          e.preventDefault();
          if (orderedOptions.length === 0) return;

          const index = orderedOptions.findIndex((option) => option.key === selectedOptionRef.current);
          const currentIndex = index >= 0 ? index : 0;
          const moveToPrevious = key === 'ArrowUp' || (key === 'Tab' && e.shiftKey);
          const nextIndex = moveToPrevious
            ? (currentIndex - 1 + orderedOptions.length) % orderedOptions.length
            : (currentIndex + 1) % orderedOptions.length;

          setSelectedOption(orderedOptions[nextIndex].key);
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
  }, [closePanel, editor, open, orderedOptions, handleSelectOption]);

  useEffect(() => {
    if (open && panelPosition) {
      const origins = calculateOptimalOrigins(panelPosition, 320, 400, undefined, 16);
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

  useEffect(() => {
    if (!linkedPicker) return;
    const origins = calculateOptimalOrigins(linkedPicker.position, 360, 360, undefined, 16);

    setLinkedTransformOrigin(origins.transformOrigin);
  }, [linkedPicker]);

  useEffect(() => {
    if (!linkedPicker) {
      setDatabaseSearch('');
    }
  }, [linkedPicker]);

  return (
    <>
      <Popover
        adjustOrigins={false}
        data-testid={'slash-panel'}
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
          ref={optionsRef}
          className={
            'appflowy-scroller flex max-h-[400px] w-[320px] flex-col gap-2 overflow-y-auto overflow-x-hidden p-2'
          }
        >
          {optionGroups.length > 0 ? (
            optionGroups.map(({ group, options: groupOptions }) => (
              <div key={group} className={'flex flex-col gap-1'}>
                <div className={'px-2 py-1 text-xs font-medium text-text-secondary'}>{groupLabels[group]}</div>
                {groupOptions.map((option) => (
                  <Button
                    size={'small'}
                    color={'inherit'}
                    startIcon={option.icon}
                    key={option.key}
                    data-testid={`slash-menu-${option.key}`}
                    data-option-key={option.key}
                    onClick={() => {
                      handleSelectOption(option.key);
                      option.onClick?.();
                    }}
                    className={`scroll-m-2 justify-start hover:bg-fill-content-hover ${
                      selectedOption === option.key ? 'bg-fill-content-hover' : ''
                    }`}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            ))
          ) : (
            <div className={'flex items-center justify-center py-4 text-sm text-text-secondary'}>
              {t('findAndReplace.noResult')}
            </div>
          )}
        </div>
      </Popover>

      <Popover
        adjustOrigins={false}
        open={!!linkedPicker}
        onClose={() => setLinkedPicker(null)}
        anchorReference={'anchorPosition'}
        anchorPosition={linkedPicker?.position}
        disableAutoFocus={true}
        disableRestoreFocus={true}
        disableEnforceFocus={true}
        transformOrigin={linkedTransformOrigin}
        onMouseDown={(e) => e.preventDefault()}
      >
        <div className={'flex h-fit max-h-[360px] min-h-[200px] w-[360px] flex-col'}>
          <Label className={'px-2 pt-2 font-normal'}>
            {t('document.slashMenu.linkedDatabase.title', { defaultValue: 'Link to an existing database' })}
          </Label>
          <SearchInput value={databaseSearch} onChange={setDatabaseSearch} className='m-2' />
          <Separator />
          <div className={'appflowy-scrollbar flex-1 overflow-y-auto overflow-x-hidden p-2'}>
            {databaseLoading ? (
              <div className={'flex h-full w-full items-center justify-center py-10 opacity-60'}>
                {t('common.loading', { defaultValue: 'Loading...' })}
              </div>
            ) : databaseError ? (
              <div className={'flex h-full w-full items-center justify-center py-10 text-destructive'}>
                {databaseError}
              </div>
            ) : filteredDatabaseTree.length > 0 ? (
              filteredDatabaseTree.map((view) => (
                <DatabaseTreeItem
                  key={view.view_id}
                  view={view}
                  allowedIds={allowedDatabaseIds}
                  onSelect={(selectedView) => {
                    void handleSelectDatabase(selectedView.view_id);
                  }}
                  fallbackTitle={t('document.view.placeholder', { defaultValue: 'Untitled' })}
                  isSearching={!!databaseSearch}
                />
              ))
            ) : (
              <div className={'flex h-full w-full items-center justify-center py-10 opacity-60'}>
                {t('document.slashMenu.linkedDatabase.empty', { defaultValue: 'No databases found' })}
              </div>
            )}
          </div>
        </div>
      </Popover>
    </>
  );
}

export default SlashPanel;
