import { Button } from '@mui/material';
import { PopoverOrigin } from '@mui/material/Popover/Popover';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Transforms } from 'slate';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { isEmbedBlockTypes } from '@/application/slate-yjs/command/const';
import { findSlateEntryByBlockId, getBlockEntry } from '@/application/slate-yjs/utils/editor';
import {
  AlignType,
  BlockData,
  BlockType,
  CalloutBlockData,
  HeadingBlockData,
  ImageBlockData,
  SubpageNodeData,
  ToggleListBlockData,
  VideoBlockData,
  View,
  ViewLayout,
} from '@/application/types';
// import { ReactComponent as AIWriterIcon } from '@/assets/slash_menu_icon_ai_writer.svg';
import { ReactComponent as EmojiIcon } from '@/assets/icons/add_emoji.svg';
import { ReactComponent as AddPageIcon } from '@/assets/icons/add_to_page.svg';
import { ReactComponent as AskAIIcon } from '@/assets/icons/ai.svg';
import { ReactComponent as BoardIcon } from '@/assets/icons/board.svg';
import { ReactComponent as BulletedListIcon } from '@/assets/icons/bulleted_list.svg';
import { ReactComponent as CalendarIcon } from '@/assets/icons/calendar.svg';
import { ReactComponent as CalloutIcon } from '@/assets/icons/callout.svg';
import { ReactComponent as ContinueWritingIcon } from '@/assets/icons/continue_writing.svg';
import { ReactComponent as DividerIcon } from '@/assets/icons/divider.svg';
import { ReactComponent as OutlineIcon } from '@/assets/icons/doc.svg';
import { ReactComponent as FileIcon } from '@/assets/icons/file.svg';
import { ReactComponent as FormulaIcon } from '@/assets/icons/formula.svg';
import { ReactComponent as GridIcon } from '@/assets/icons/grid.svg';
import { ReactComponent as Heading1Icon } from '@/assets/icons/h1.svg';
import { ReactComponent as Heading2Icon } from '@/assets/icons/h2.svg';
import { ReactComponent as Heading3Icon } from '@/assets/icons/h3.svg';
import { ReactComponent as ImageIcon } from '@/assets/icons/image.svg';
import { ReactComponent as CodeIcon } from '@/assets/icons/inline_code.svg';
import { ReactComponent as NumberedListIcon } from '@/assets/icons/numbered_list.svg';
import { ReactComponent as DocumentIcon } from '@/assets/icons/page.svg';
import { ReactComponent as QuoteIcon } from '@/assets/icons/quote.svg';
import { ReactComponent as RefDocumentIcon } from '@/assets/icons/ref_page.svg';
import { ReactComponent as TextIcon } from '@/assets/icons/text.svg';
import { ReactComponent as TodoListIcon } from '@/assets/icons/todo.svg';
import { ReactComponent as ToggleHeading1Icon } from '@/assets/icons/toggle_h1.svg';
import { ReactComponent as ToggleHeading2Icon } from '@/assets/icons/toggle_h2.svg';
import { ReactComponent as ToggleHeading3Icon } from '@/assets/icons/toggle_h3.svg';
import { ReactComponent as ChevronRight, ReactComponent as ToggleListIcon } from '@/assets/icons/toggle_list.svg';
import { ReactComponent as VideoIcon } from '@/assets/icons/video.svg';
import { notify } from '@/components/_shared/notify';
import { flattenViews } from '@/components/_shared/outline/utils';
import { calculateOptimalOrigins, Popover } from '@/components/_shared/popover';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
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
import { getCharacters } from '@/utils/word';

type DatabaseOption = {
  databaseId: string;
  view: View;
};

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
}> = ({ view, allowedIds, onSelect, fallbackTitle }) => {
  const [expanded, setExpanded] = useState(view.extra?.is_space || false);
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

          setExpanded((prev) => !prev);
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
                setExpanded((prev) => !prev);
              }}
            >
              <ChevronRight className={`transform transition-transform ${expanded ? 'rotate-90' : 'rotate-0'}`} />
            </OutlineButton>
          ) : (
            <div style={{ width: 16, height: 16 }} />
          )}
          <PageIcon view={view} />
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
      {hasChildren && expanded && (
        <div className={'flex flex-col gap-1 pl-4'}>
          {view.children?.map((child) => (
            <DatabaseTreeItem
              key={child.view_id}
              view={child}
              allowedIds={allowedIds}
              onSelect={onSelect}
              fallbackTitle={fallbackTitle}
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
  const { isPanelOpen, panelPosition, closePanel, searchText, removeContent } = usePanelContext();
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
        // Skip selection for database blocks (Grid, Board, Calendar) as they open in a modal
        // and don't need cursor positioning. Explicitly deselect to prevent Slate from scrolling.
        const isDatabaseBlock = [BlockType.GridBlock, BlockType.BoardBlock, BlockType.CalendarBlock].includes(type);

        if (isDatabaseBlock) {
          Transforms.deselect(editor);
        } else {
          const entry = findSlateEntryByBlockId(editor, newBlockId);

          if (!entry) return;

          const [, path] = entry;

          editor.select(editor.start(path));
        }
      }

      if ([BlockType.FileBlock, BlockType.ImageBlock, BlockType.EquationBlock, BlockType.VideoBlock].includes(type)) {
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

  const { openPanel } = usePanelContext();

  const { askAIAnything, continueWriting } = useAIWriter();

  const loadDatabasesForPicker = useCallback(async () => {
    if (!loadViews) return false;
    setDatabaseLoading(true);
    setDatabaseError(null);

    try {
      const views = (await loadViews()) || [];

      setDatabaseOutline(views);
      const flatViews = flattenViews(views);

      // Identify databases by their layout type (Grid, Board, Calendar)
      // ViewLayout enum values: Grid=1, Board=2, Calendar=3
      const databaseLayouts = [ViewLayout.Grid, ViewLayout.Board, ViewLayout.Calendar];
      const databaseViews = flatViews.filter((view) => {
        // view.layout is ViewLayout enum, compare directly
        return databaseLayouts.includes(view.layout);
      });

      // Build options - databaseId will be fetched from viewMeta when user selects
      // The outline API doesn't include database_relations, so we set empty string here
      const options: DatabaseOption[] = databaseViews.map((view) => ({
        databaseId: '', // Will be fetched from loadViewMeta in handleSelectDatabase
        view,
      }));

      console.debug('[SlashPanel] loadDatabasesForPicker:', {
        totalViews: flatViews.length,
        databaseViews: databaseViews.length,
        databaseViewNames: databaseViews.map(v => v.name),
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
        const baseName =
          option.view.name ||
          t('document.view.placeholder', { defaultValue: 'Untitled' });

        // Fetch the view's metadata to get the correct database_id
        // The outline API doesn't include database_relations, so we MUST fetch it here
        if (!loadViewMeta) {
          notify.error(t('document.slashMenu.linkedDatabase.actionUnavailable', {
            defaultValue: 'Unable to fetch database information',
          }));
          return;
        }

        const viewMeta = await loadViewMeta(databaseViewId);

        console.debug('[SlashPanel] viewMeta for database:', {
          viewId: databaseViewId,
          viewName: baseName,
          database_relations: viewMeta?.database_relations,
          fullMeta: viewMeta,
        });

        if (!viewMeta?.database_relations) {
          notify.error(t('document.slashMenu.linkedDatabase.actionUnavailable', {
            defaultValue: 'Database relations not found',
          }));
          return;
        }

        // database_relations is Record<DatabaseId, ViewId>
        // Find the entry where the value (base view id) matches this view
        let relationEntry = Object.entries(viewMeta.database_relations).find(
          ([_, baseViewId]) => baseViewId === databaseViewId
        );

        // If not found, try refreshing database relations (for newly created databases)
        if (!relationEntry && loadDatabaseRelations) {
          console.debug('[SlashPanel] database_id not found in cache, refreshing relations...', {
            viewId: databaseViewId,
          });

          // Refresh and get fresh relations directly (don't rely on React state update)
          const freshRelations = await loadDatabaseRelations();

          console.debug('[SlashPanel] Fresh relations after refresh:', {
            viewId: databaseViewId,
            freshRelations,
          });

          if (freshRelations) {
            relationEntry = Object.entries(freshRelations).find(
              ([_, baseViewId]) => baseViewId === databaseViewId
            );
          }
        }

        if (!relationEntry) {
          console.error('[SlashPanel] Could not find database_id for view:', {
            viewId: databaseViewId,
            database_relations: viewMeta.database_relations,
          });
          notify.error(t('document.slashMenu.linkedDatabase.actionUnavailable', {
            defaultValue: 'Could not find database ID',
          }));
          return;
        }

        const databaseId = relationEntry[0];

        console.debug('[SlashPanel] Found database_id:', {
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

        console.debug('[SlashPanel] {} created linked database', {
          documentId,
          databaseViewId,
          newViewId: response.view_id,
          referencedName,
        });

        turnInto(blockType, createDatabaseNodeData({
          parentId: documentId,
          viewIds: [response.view_id],
          databaseId: response.database_id,
        }));
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

  const options: {
    label: string;
    key: string;
    icon: React.ReactNode;
    keywords: string[];
    onClick?: () => void;
  }[] = useMemo(() => {
    return [
      {
        label: t('document.slashMenu.name.askAIAnything'),
        key: 'askAIAnything',
        icon: <AskAIIcon />,
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
        keywords: ['ai', 'writing', 'continue'],
        onClick: () => {
          const content = getBeforeContent();

          void continueWriting(content);
        },
      },
      {
        label: t('document.slashMenu.name.text'),
        key: 'text',
        icon: <TextIcon />,
        onClick: () => {
          turnInto(BlockType.Paragraph, {});
        },
        keywords: ['text', 'paragraph'],
      },
      {
        label: t('document.slashMenu.name.heading1'),
        key: 'heading1',
        icon: <Heading1Icon />,
        keywords: ['heading1', 'h1', 'heading'],
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
        keywords: ['heading2', 'h2', 'subheading', 'heading'],
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
        keywords: ['heading3', 'h3', 'subheading', 'heading'],
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
        keywords: ['image', 'img'],
        onClick: () => {
          turnInto(BlockType.ImageBlock, {
            url: '',
            align: AlignType.Center,
          } as ImageBlockData);
        },
      },
      {
        label: t('embedVideo'),
        key: 'video',
        icon: <VideoIcon />,
        keywords: ['video', 'youtube', 'embed'],
        onClick: () => {
          turnInto(BlockType.VideoBlock, {
            url: '',
            align: AlignType.Center,
          } as VideoBlockData);
        },
      },
      {
        label: t('document.slashMenu.name.bulletedList'),
        key: 'bulletedList',
        icon: <BulletedListIcon />,
        keywords: ['bulleted', 'list'],
        onClick: () => {
          turnInto(BlockType.BulletedListBlock, {});
        },
      },
      {
        label: t('document.slashMenu.name.numberedList'),
        key: 'numberedList',
        icon: <NumberedListIcon />,
        keywords: ['numbered', 'list'],
        onClick: () => {
          turnInto(BlockType.NumberedListBlock, {});
        },
      },
      {
        label: t('document.slashMenu.name.todoList'),
        key: 'todoList',
        icon: <TodoListIcon />,
        keywords: ['todo', 'list'],
        onClick: () => {
          turnInto(BlockType.TodoListBlock, {});
        },
      },
      {
        label: t('document.slashMenu.name.divider'),
        key: 'divider',
        icon: <DividerIcon />,
        keywords: ['divider', 'line'],
        onClick: () => {
          turnInto(BlockType.DividerBlock, {});
        },
      },
      {
        label: t('document.slashMenu.name.quote'),
        key: 'quote',
        icon: <QuoteIcon />,
        keywords: ['quote'],
        onClick: () => {
          turnInto(BlockType.QuoteBlock, {});
        },
      },
      {
        label: t('document.slashMenu.name.linkedDoc'),
        key: 'linkedDoc',
        icon: <RefDocumentIcon />,
        keywords: ['linked', 'doc', 'page', 'document'],
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
        keywords: ['document', 'doc', 'page', 'create', 'add'],
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
        keywords: ['grid', 'table', 'database'],
        onClick: async () => {
          if (!documentId || !addPage || !openPageModal) return;

          let scrollContainer: Element | null = null;

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
              name: t('document.slashMenu.name.grid'),
            });

            console.debug('[SlashPanel] {} created grid', {
              documentId,
              databaseViewId: response.view_id,
            });

            turnInto(BlockType.GridBlock, createDatabaseNodeData({
              parentId: documentId,
              viewIds: [response.view_id],
              databaseId: response.database_id,
            }));

            openPageModal(response.view_id);

            if (savedScrollTop !== undefined) {
              const restoreScroll = () => {
                const currentContainer = document.querySelector('.appflowy-scroll-container');

                if (currentContainer) {
                  currentContainer.scrollTop = savedScrollTop;
                }
              };

              setTimeout(restoreScroll, 50);
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
        keywords: ['linked', 'grid', 'table', 'database'],
        onClick: () => {
          void handleOpenLinkedDatabasePicker(ViewLayout.Grid, 'linkedGrid');
        },
      },
      {
        label: t('document.slashMenu.name.kanban'),
        key: 'board',
        icon: <BoardIcon />,
        keywords: ['board', 'kanban', 'database'],
        onClick: async () => {
          if (!documentId || !addPage || !openPageModal) return;

          let scrollContainer: Element | null = null;

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
              name: t('document.slashMenu.name.kanban'),
            });

            console.debug('[SlashPanel] {} created kanban', {
              documentId,
              databaseViewId: response.view_id,
            });

            turnInto(BlockType.BoardBlock, createDatabaseNodeData({
              parentId: documentId,
              viewIds: [response.view_id],
              databaseId: response.database_id,
            }));

            openPageModal(response.view_id);

            if (savedScrollTop !== undefined) {
              const restoreScroll = () => {
                const currentContainer = document.querySelector('.appflowy-scroll-container');

                if (currentContainer) {
                  currentContainer.scrollTop = savedScrollTop;
                }
              };

              setTimeout(restoreScroll, 50);
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
        keywords: ['linked', 'kanban', 'board', 'database'],
        onClick: () => {
          void handleOpenLinkedDatabasePicker(ViewLayout.Board, 'linkedKanban');
        },
      },
      {
        label: t('document.slashMenu.name.calendar'),
        key: 'calendar',
        icon: <CalendarIcon />,
        keywords: ['calendar', 'date', 'database'],
        onClick: async () => {
          if (!documentId || !addPage || !openPageModal) return;

          let scrollContainer: Element | null = null;

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
              name: t('document.slashMenu.name.calendar'),
            });

            console.debug('[SlashPanel] {} created calendar', {
              documentId,
              databaseViewId: response.view_id,
            });

            turnInto(BlockType.CalendarBlock, createDatabaseNodeData({
              parentId: documentId,
              viewIds: [response.view_id],
              databaseId: response.database_id,
            }));

            openPageModal(response.view_id);

            if (savedScrollTop !== undefined) {
              const restoreScroll = () => {
                const currentContainer = document.querySelector('.appflowy-scroll-container');

                if (currentContainer) {
                  currentContainer.scrollTop = savedScrollTop;
                }
              };

              setTimeout(restoreScroll, 50);
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
        keywords: ['linked', 'calendar', 'date', 'database'],
        onClick: () => {
          void handleOpenLinkedDatabasePicker(ViewLayout.Calendar, 'linkedCalendar');
        },
      },
      {
        label: t('document.slashMenu.name.callout'),
        key: 'callout',
        icon: <CalloutIcon />,
        keywords: ['callout'],
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
        keywords: ['outline', 'table', 'contents'],
        onClick: () => {
          turnInto(BlockType.OutlineBlock, {});
        },
      },
      {
        label: t('document.slashMenu.name.mathEquation'),
        key: 'math',
        icon: <FormulaIcon />,
        keywords: ['math', 'equation', 'formula'],
        onClick: () => {
          turnInto(BlockType.EquationBlock, {});
        },
      },
      {
        label: t('document.slashMenu.name.code'),
        key: 'code',
        icon: <CodeIcon />,
        keywords: ['code', 'block'],
        onClick: () => {
          turnInto(BlockType.CodeBlock, {});
        },
      },
      {
        label: t('document.slashMenu.name.toggleList'),
        key: 'toggleList',
        icon: <ToggleListIcon />,
        keywords: ['toggle', 'list'],
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
        keywords: ['toggle', 'heading1', 'h1', 'heading'],
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
        keywords: ['toggle', 'heading2', 'h2', 'subheading', 'heading'],
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
        keywords: ['toggle', 'heading3', 'h3', 'subheading', 'heading'],
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
        keywords: ['emoji'],
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
        label: t('document.slashMenu.name.file'),
        key: 'file',
        icon: <FileIcon />,
        keywords: ['file', 'upload'],
        onClick: () => {
          turnInto(BlockType.FileBlock, {});
        },
      },
    ].filter((option) => {
      if (option.disabled) return false;
      if (!searchText) return true;
      return option.keywords.some((keyword: string) => {
        return keyword.toLowerCase().includes(searchText.toLowerCase());
      });
    });
  }, [
    t,
    chars,
    getBeforeContent,
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
  ]);

  const resultLength = options.length;

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
    if (!open || options.length === 0) return;
    setSelectedOption(options[0].key);
  }, [open, options]);

  const countRef = useRef(0);

  useEffect(() => {
    if (!open) return;

    if (searchText && resultLength === 0) {
      countRef.current += 1;
    } else {
      countRef.current = 0;
    }

    if (countRef.current > 1) {
      closePanel();
      countRef.current = 0;
      return;
    }
  }, [closePanel, open, resultLength, searchText]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      const { key } = e;

      switch (key) {
        case 'Enter':
          e.stopPropagation();
          e.preventDefault();
          if (selectedOptionRef.current) {
            handleSelectOption(selectedOptionRef.current);
            const item = options.find((option) => option.key === selectedOptionRef.current);

            item?.onClick?.();
          }

          break;
        case 'ArrowUp':
        case 'ArrowDown': {
          e.stopPropagation();
          e.preventDefault();
          const index = options.findIndex((option) => option.key === selectedOptionRef.current);
          const nextIndex =
            key === 'ArrowDown' ? (index + 1) % options.length : (index - 1 + options.length) % options.length;

          setSelectedOption(options[nextIndex].key);
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
  }, [closePanel, editor, open, options, handleSelectOption]);

  useEffect(() => {
    if (options.length > 0) return;
    setSelectedOption(null);
  }, [options.length]);

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
          {options.length > 0 ? (
            options.map((option) => (
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
                className={`scroll-m-2 justify-start hover:bg-fill-content-hover ${selectedOption === option.key ? 'bg-fill-content-hover' : ''
                  }`}
              >
                {option.label}
              </Button>
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
