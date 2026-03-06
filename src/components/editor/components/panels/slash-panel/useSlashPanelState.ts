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
  AlignType, BlockData, BlockType, CalloutBlockData, HeadingBlockData,
  ImageBlockData, SubpageNodeData, ToggleListBlockData, VideoBlockData,
  View, ViewLayout,
} from '@/application/types';
import { ReactComponent as AskAIIcon } from '@/assets/icons/ai.svg';
import { ReactComponent as BoardIcon } from '@/assets/icons/board.svg';
import { ReactComponent as BulletedListIcon } from '@/assets/icons/bulleted_list.svg';
import { ReactComponent as CalendarIcon } from '@/assets/icons/calendar.svg';
import { ReactComponent as CalloutIcon } from '@/assets/icons/callout.svg';
import { ReactComponent as ContinueWritingIcon } from '@/assets/icons/continue_writing.svg';
import { ReactComponent as DividerIcon } from '@/assets/icons/divider.svg';
import { ReactComponent as OutlineIcon } from '@/assets/icons/doc.svg';
import { ReactComponent as EmojiIcon } from '@/assets/icons/add_emoji.svg';
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
import { ReactComponent as ToggleListIcon } from '@/assets/icons/toggle_list.svg';
import { ReactComponent as VideoIcon } from '@/assets/icons/video.svg';
import { notify } from '@/components/_shared/notify';
import { calculateOptimalOrigins } from '@/components/_shared/popover';
import { useAIWriter } from '@/components/chat';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { createDatabaseNodeData } from '@/components/editor/components/blocks/database/utils/databaseBlockUtils';
import { usePanelContext } from '@/components/editor/components/panels/Panels.hooks';
import { PanelType } from '@/components/editor/components/panels/PanelsContext';
import { getRangeRect } from '@/components/editor/components/toolbar/selection-toolbar/utils';
import { useEditorContext } from '@/components/editor/EditorContext';
import { Log } from '@/utils/log';
import { getCharacters } from '@/utils/word';

import { collectSelectableDatabaseViews, DatabaseOption, filterViewsByDatabases, SlashMenuOption } from './slash-panel.utils';

/**
 * Static icon elements extracted as module-level constants.
 * React best practice: JSX creates new element objects. Keeping icons outside
 * useMemo ensures the same reference is reused across renders, preventing
 * unnecessary downstream updates.
 */
const ICONS = {
  askAI: <AskAIIcon />,
  continueWriting: <ContinueWritingIcon />,
  text: <TextIcon />,
  heading1: <Heading1Icon />,
  heading2: <Heading2Icon />,
  heading3: <Heading3Icon />,
  image: <ImageIcon />,
  video: <VideoIcon />,
  bulletedList: <BulletedListIcon />,
  numberedList: <NumberedListIcon />,
  todoList: <TodoListIcon />,
  divider: <DividerIcon />,
  quote: <QuoteIcon />,
  linkedDoc: <RefDocumentIcon />,
  document: <DocumentIcon />,
  grid: <GridIcon />,
  board: <BoardIcon />,
  calendar: <CalendarIcon />,
  callout: <CalloutIcon />,
  outline: <OutlineIcon />,
  math: <FormulaIcon />,
  code: <CodeIcon />,
  toggleList: <ToggleListIcon />,
  toggleHeading1: <ToggleHeading1Icon />,
  toggleHeading2: <ToggleHeading2Icon />,
  toggleHeading3: <ToggleHeading3Icon />,
  emoji: <EmojiIcon />,
  file: <FileIcon />,
};

interface LinkedPickerState {
  position: { top: number; left: number };
  layout: ViewLayout;
}

export interface SlashPanelState {
  // Popover control
  open: boolean;
  panelPosition: { top: number; left: number } | undefined;
  transformOrigin: PopoverOrigin | undefined;
  closePanel: () => void;

  // Menu options
  options: SlashMenuOption[];
  selectedOption: string | null;
  optionsRef: React.RefObject<HTMLDivElement>;
  handleSelectOption: (key: string) => void;

  // Linked database picker
  linkedPicker: LinkedPickerState | null;
  linkedTransformOrigin: PopoverOrigin | undefined;
  databaseSearch: string;
  setDatabaseSearch: (v: string) => void;
  databaseLoading: boolean;
  databaseError: string | null;
  filteredDatabaseTree: View[];
  allowedDatabaseIds: Set<string>;
  handleSelectDatabase: (viewId: string) => Promise<void>;
  closeLinkedPicker: () => void;
}

export function useSlashPanelState(
  setEmojiPosition: (pos: { top: number; left: number }) => void
): SlashPanelState {
  const { isPanelOpen, panelPosition, closePanel, searchText, removeContent } = usePanelContext();
  const { addPage, openPageModal, viewId: documentId, loadViewMeta, getMoreAIContext,
    createDatabaseView, loadViews, loadDatabaseRelations } = useEditorContext();
  const [viewName, setViewName] = useState('');
  const [linkedPicker, setLinkedPicker] = useState<LinkedPickerState | null>(null);
  const [linkedTransformOrigin, setLinkedTransformOrigin] = useState<PopoverOrigin | undefined>(undefined);
  const [databaseSearch, setDatabaseSearch] = useState('');
  const [databaseOutline, setDatabaseOutline] = useState<View[]>([]);
  const [databaseOptions, setDatabaseOptions] = useState<DatabaseOption[]>([]);
  const [databaseLoading, setDatabaseLoading] = useState(false);
  const [databaseError, setDatabaseError] = useState<string | null>(null);

  const editor = useSlateStatic() as YjsEditor;
  const { t } = useTranslation();
  const optionsRef = useRef<HTMLDivElement>(null);
  const [selectedOption, setSelectedOption] = useState<string | null>(null);
  const [transformOrigin, setTransformOrigin] = useState<PopoverOrigin | undefined>(undefined);
  const selectedOptionRef = useRef<string | null>(null);
  const { openPopover } = usePopoverContext();
  const { openPanel } = usePanelContext();
  const { askAIAnything, continueWriting } = useAIWriter();

  const open = useMemo(() => isPanelOpen(PanelType.Slash), [isPanelOpen]);

  useEffect(() => {
    if (documentId && open) {
      void loadViewMeta?.(documentId).then((view) => {
        if (view) setViewName(view.name);
      });
    }
  }, [documentId, loadViewMeta, open]);

  const getBeforeContent = useCallback(() => {
    const { selection } = editor;
    if (!selection) return '';
    const start = { path: [0], offset: 0 };
    const end = editor.end(selection);
    const moreContext = getMoreAIContext?.();
    return viewName + '\n' + (moreContext ? `More context: ${moreContext} \n` : '') +
      CustomEditor.getSelectionContent(editor, { anchor: start, focus: end });
  }, [editor, viewName, getMoreAIContext]);

  const chars = useMemo(() => {
    if (!open) return 0;
    return getCharacters(getBeforeContent());
  }, [open, getBeforeContent]);

  const blockTypeByLayout = useCallback((layout: ViewLayout) => {
    switch (layout) {
      case ViewLayout.Grid: return BlockType.GridBlock;
      case ViewLayout.Board: return BlockType.BoardBlock;
      case ViewLayout.Calendar: return BlockType.CalendarBlock;
      default: return null;
    }
  }, []);

  const handleSelectOption = useCallback((option: string) => {
    setSelectedOption(option);
    removeContent();
    closePanel();
    editor.flushLocalChanges();
  }, [closePanel, removeContent, editor]);

  const turnInto = useCallback((type: BlockType, data: BlockData) => {
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
  }, [editor, openPopover]);

  const allowedDatabaseIds = useMemo(() => new Set(databaseOptions.map((o) => o.view.view_id)), [databaseOptions]);

  const filteredDatabaseTree = useMemo(() => {
    if (!databaseOutline.length) return [];
    return filterViewsByDatabases(databaseOutline, allowedDatabaseIds, databaseSearch);
  }, [databaseOutline, allowedDatabaseIds, databaseSearch]);

  const loadDatabasesForPicker = useCallback(async () => {
    if (!loadViews) return false;
    setDatabaseLoading(true);
    setDatabaseError(null);
    try {
      const views = (await loadViews()) || [];
      setDatabaseOutline(views);
      const selectableViews = collectSelectableDatabaseViews(views);
      const options: DatabaseOption[] = selectableViews.map((view) => ({ databaseId: '', view }));
      Log.debug('[SlashPanel] loadDatabasesForPicker:', { databaseViews: selectableViews.length });
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

  const handleOpenLinkedDatabasePicker = useCallback(async (layout: ViewLayout, optionKey: string) => {
    if (!documentId || !createDatabaseView) return;
    const rect = getRangeRect();
    if (!rect) return;
    handleSelectOption(optionKey);
    setDatabaseSearch('');
    const hasDatabases = await loadDatabasesForPicker();
    if (!hasDatabases) {
      notify.error(t('document.slashMenu.linkedDatabase.empty', { defaultValue: 'No databases available to link' }));
      setLinkedPicker(null);
      return;
    }
    setLinkedPicker({ position: { top: rect.top, left: rect.left }, layout });
  }, [createDatabaseView, handleSelectOption, loadDatabasesForPicker, t, documentId]);

  const handleSelectDatabase = useCallback(async (targetViewId: string) => {
    if (!linkedPicker) return;
    if (!createDatabaseView || !documentId) {
      notify.error(t('document.slashMenu.linkedDatabase.actionUnavailable', { defaultValue: 'Linking databases is not available right now' }));
      return;
    }
    const option = databaseOptions.find((item) => item.view.view_id === targetViewId);
    const blockType = blockTypeByLayout(linkedPicker.layout);
    if (!option || !blockType) { setLinkedPicker(null); return; }
    try {
      const databaseViewId = option.view.view_id;
      const baseName = option.view.name || t('document.view.placeholder', { defaultValue: 'Untitled' });
      let databaseId = option.view.extra?.database_id;
      let viewMeta: View | null = null;
      if (!databaseId) {
        if (!loadViewMeta) {
          notify.error(t('document.slashMenu.linkedDatabase.actionUnavailable', { defaultValue: 'Unable to fetch database information' }));
          return;
        }
        viewMeta = await loadViewMeta(databaseViewId);
        databaseId = viewMeta?.extra?.database_id;
      }
      if (!databaseId && viewMeta?.database_relations) {
        let relationEntry = Object.entries(viewMeta.database_relations).find(([_, baseViewId]) => baseViewId === databaseViewId);
        if (!relationEntry && loadDatabaseRelations) {
          const freshRelations = await loadDatabaseRelations();
          if (freshRelations) {
            relationEntry = Object.entries(freshRelations).find(([_, baseViewId]) => baseViewId === databaseViewId);
          }
        }
        if (relationEntry) databaseId = relationEntry[0];
      }
      if (!databaseId) {
        notify.error(t('document.slashMenu.linkedDatabase.actionUnavailable', { defaultValue: 'Could not find database ID' }));
        return;
      }
      const prefix = (() => {
        switch (linkedPicker.layout) {
          case ViewLayout.Grid: return t('document.grid.referencedGridPrefix', { defaultValue: 'View of' });
          case ViewLayout.Board: return t('document.board.referencedBoardPrefix', { defaultValue: 'View of' });
          case ViewLayout.Calendar: return t('document.calendar.referencedCalendarPrefix', { defaultValue: 'View of' });
          default: return '';
        }
      })();
      const referencedName = prefix ? `${prefix} ${baseName}` : baseName;
      const response = await createDatabaseView(documentId, {
        parent_view_id: documentId, database_id: databaseId,
        layout: linkedPicker.layout, name: referencedName, embedded: true,
      });
      turnInto(blockType, createDatabaseNodeData({ parentId: documentId, viewIds: [response.view_id], databaseId: response.database_id }));
    } catch (e) {
      notify.error((e as Error).message);
    } finally {
      setLinkedPicker(null);
    }
  }, [linkedPicker, createDatabaseView, documentId, databaseOptions, blockTypeByLayout, turnInto, t, loadViewMeta, loadDatabaseRelations]);

  const options: SlashMenuOption[] = useMemo(() => {
    return [
      { label: t('document.slashMenu.name.askAIAnything'), key: 'askAIAnything', icon: ICONS.askAI, keywords: ['ai', 'writer', 'ask', 'anything', 'askAIAnything', 'askai'], onClick: () => { askAIAnything(getBeforeContent()); } },
      { label: t('document.slashMenu.name.continueWriting'), key: 'continueWriting', disabled: chars < 2, icon: ICONS.continueWriting, keywords: ['ai', 'writing', 'continue'], onClick: () => { void continueWriting(getBeforeContent()); } },
      { label: t('document.slashMenu.name.text'), key: 'text', icon: ICONS.text, keywords: ['text', 'paragraph'], onClick: () => { turnInto(BlockType.Paragraph, {}); } },
      { label: t('document.slashMenu.name.heading1'), key: 'heading1', icon: ICONS.heading1, keywords: ['heading1', 'h1', 'heading'], onClick: () => { turnInto(BlockType.HeadingBlock, { level: 1 } as HeadingBlockData); } },
      { label: t('document.slashMenu.name.heading2'), key: 'heading2', icon: ICONS.heading2, keywords: ['heading2', 'h2', 'subheading', 'heading'], onClick: () => { turnInto(BlockType.HeadingBlock, { level: 2 } as HeadingBlockData); } },
      { label: t('document.slashMenu.name.heading3'), key: 'heading3', icon: ICONS.heading3, keywords: ['heading3', 'h3', 'subheading', 'heading'], onClick: () => { turnInto(BlockType.HeadingBlock, { level: 3 } as HeadingBlockData); } },
      { label: t('document.slashMenu.name.image'), key: 'image', icon: ICONS.image, keywords: ['image', 'img'], onClick: () => { turnInto(BlockType.ImageBlock, { url: '', align: AlignType.Center } as ImageBlockData); } },
      { label: t('embedVideo'), key: 'video', icon: ICONS.video, keywords: ['video', 'youtube', 'embed'], onClick: () => { turnInto(BlockType.VideoBlock, { url: '', align: AlignType.Center } as VideoBlockData); } },
      { label: t('document.slashMenu.name.bulletedList'), key: 'bulletedList', icon: ICONS.bulletedList, keywords: ['bulleted', 'list'], onClick: () => { turnInto(BlockType.BulletedListBlock, {}); } },
      { label: t('document.slashMenu.name.numberedList'), key: 'numberedList', icon: ICONS.numberedList, keywords: ['numbered', 'list'], onClick: () => { turnInto(BlockType.NumberedListBlock, {}); } },
      { label: t('document.slashMenu.name.todoList'), key: 'todoList', icon: ICONS.todoList, keywords: ['todo', 'list'], onClick: () => { turnInto(BlockType.TodoListBlock, {}); } },
      { label: t('document.slashMenu.name.divider'), key: 'divider', icon: ICONS.divider, keywords: ['divider', 'line'], onClick: () => { turnInto(BlockType.DividerBlock, {}); } },
      { label: t('document.slashMenu.name.quote'), key: 'quote', icon: ICONS.quote, keywords: ['quote'], onClick: () => { turnInto(BlockType.QuoteBlock, {}); } },
      { label: t('document.slashMenu.name.linkedDoc'), key: 'linkedDoc', icon: ICONS.linkedDoc, keywords: ['linked', 'doc', 'page', 'document'], onClick: () => { const rect = getRangeRect(); if (!rect) return; openPanel(PanelType.PageReference, { top: rect.top, left: rect.left }); } },
      { label: t('document.menuName'), key: 'document', icon: ICONS.document, keywords: ['document', 'doc', 'page', 'create', 'add'], onClick: async () => { if (!documentId || !addPage || !openPageModal) return; try { const response = await addPage(documentId, { layout: ViewLayout.Document }); turnInto(BlockType.SubpageBlock, { view_id: response.view_id } as SubpageNodeData); openPageModal(response.view_id); } catch (e: any) { notify.error(e.message); } } },
      { label: t('document.slashMenu.name.grid'), key: 'grid', icon: ICONS.grid, keywords: ['grid', 'table', 'database'], onClick: async () => { if (!documentId || !addPage || !openPageModal) return; let scrollContainer: HTMLElement | null = null; try { const domNode = ReactEditor.toDOMNode(editor, editor); scrollContainer = domNode.closest('.appflowy-scroll-container'); } catch (e) { /* ignore */ } if (!scrollContainer) scrollContainer = document.querySelector('.appflowy-scroll-container'); const savedScrollTop = scrollContainer?.scrollTop; try { const response = await addPage(documentId, { layout: ViewLayout.Grid, name: t('document.plugins.database.newDatabase') }); turnInto(BlockType.GridBlock, createDatabaseNodeData({ parentId: documentId, viewIds: [response.view_id], databaseId: response.database_id })); openPageModal(response.view_id); if (savedScrollTop !== undefined) { const restore = () => { let c: HTMLElement | null = scrollContainer?.isConnected ? scrollContainer : document.querySelector('.appflowy-scroll-container'); if (!c || Math.abs(c.scrollTop - savedScrollTop) <= 5) return; c.scrollTop = savedScrollTop; }; requestAnimationFrame(restore); [50, 250, 600, 1200, 1800].forEach(d => setTimeout(restore, d)); } } catch (e: any) { notify.error(e.message); } } },
      { label: t('document.slashMenu.name.linkedGrid'), key: 'linkedGrid', icon: ICONS.grid, keywords: ['linked', 'grid', 'table', 'database'], onClick: () => { void handleOpenLinkedDatabasePicker(ViewLayout.Grid, 'linkedGrid'); } },
      { label: t('document.slashMenu.name.kanban'), key: 'board', icon: ICONS.board, keywords: ['board', 'kanban', 'database'], onClick: async () => { if (!documentId || !addPage || !openPageModal) return; let scrollContainer: HTMLElement | null = null; try { const domNode = ReactEditor.toDOMNode(editor, editor); scrollContainer = domNode.closest('.appflowy-scroll-container'); } catch { /* ignore */ } if (!scrollContainer) scrollContainer = document.querySelector('.appflowy-scroll-container'); const savedScrollTop = scrollContainer?.scrollTop; try { const response = await addPage(documentId, { layout: ViewLayout.Board, name: t('document.plugins.database.newDatabase') }); turnInto(BlockType.BoardBlock, createDatabaseNodeData({ parentId: documentId, viewIds: [response.view_id], databaseId: response.database_id })); openPageModal(response.view_id); if (savedScrollTop !== undefined) { const restore = () => { let c: HTMLElement | null = scrollContainer?.isConnected ? scrollContainer : document.querySelector('.appflowy-scroll-container'); if (!c || Math.abs(c.scrollTop - savedScrollTop) <= 5) return; c.scrollTop = savedScrollTop; }; requestAnimationFrame(restore); [50, 250, 600, 1200, 1800].forEach(d => setTimeout(restore, d)); } } catch (e: any) { notify.error(e.message); } } },
      { label: t('document.slashMenu.name.linkedKanban'), key: 'linkedBoard', icon: ICONS.board, keywords: ['linked', 'board', 'kanban', 'database'], onClick: () => { void handleOpenLinkedDatabasePicker(ViewLayout.Board, 'linkedBoard'); } },
      { label: t('document.slashMenu.name.calendar'), key: 'calendar', icon: ICONS.calendar, keywords: ['calendar', 'date'], onClick: async () => { if (!documentId || !addPage || !openPageModal) return; try { const response = await addPage(documentId, { layout: ViewLayout.Calendar, name: t('document.plugins.database.newDatabase') }); turnInto(BlockType.CalendarBlock, createDatabaseNodeData({ parentId: documentId, viewIds: [response.view_id], databaseId: response.database_id })); openPageModal(response.view_id); } catch (e: any) { notify.error(e.message); } } },
      { label: t('document.slashMenu.name.linkedCalendar'), key: 'linkedCalendar', icon: ICONS.calendar, keywords: ['linked', 'calendar', 'date'], onClick: () => { void handleOpenLinkedDatabasePicker(ViewLayout.Calendar, 'linkedCalendar'); } },
      { label: t('document.slashMenu.name.callout'), key: 'callout', icon: ICONS.callout, keywords: ['callout'], onClick: () => { turnInto(BlockType.CalloutBlock, { icon: '📌' } as CalloutBlockData); } },
      { label: t('document.slashMenu.name.outline'), key: 'outline', icon: ICONS.outline, keywords: ['outline', 'table', 'contents'], onClick: () => { turnInto(BlockType.OutlineBlock, {}); } },
      { label: t('document.slashMenu.name.mathEquation'), key: 'math', icon: ICONS.math, keywords: ['math', 'equation', 'formula'], onClick: () => { turnInto(BlockType.EquationBlock, {}); } },
      { label: t('document.slashMenu.name.code'), key: 'code', icon: ICONS.code, keywords: ['code', 'block'], onClick: () => { turnInto(BlockType.CodeBlock, {}); } },
      { label: t('document.slashMenu.name.toggleList'), key: 'toggleList', icon: ICONS.toggleList, keywords: ['toggle', 'list'], onClick: () => { turnInto(BlockType.ToggleListBlock, { collapsed: false } as ToggleListBlockData); } },
      { label: t('document.slashMenu.name.toggleHeading1'), key: 'toggleHeading1', icon: ICONS.toggleHeading1, keywords: ['toggle', 'heading1', 'h1', 'heading'], onClick: () => { turnInto(BlockType.ToggleListBlock, { collapsed: false, level: 1 } as ToggleListBlockData); } },
      { label: t('document.slashMenu.name.toggleHeading2'), key: 'toggleHeading2', icon: ICONS.toggleHeading2, keywords: ['toggle', 'heading2', 'h2', 'subheading', 'heading'], onClick: () => { turnInto(BlockType.ToggleListBlock, { collapsed: false, level: 2 } as ToggleListBlockData); } },
      { label: t('document.slashMenu.name.toggleHeading3'), key: 'toggleHeading3', icon: ICONS.toggleHeading3, keywords: ['toggle', 'heading3', 'h3', 'subheading', 'heading'], onClick: () => { turnInto(BlockType.ToggleListBlock, { collapsed: false, level: 3 } as ToggleListBlockData); } },
      { label: t('document.slashMenu.name.emoji'), key: 'emoji', icon: ICONS.emoji, keywords: ['emoji'], onClick: () => { setTimeout(() => { const rect = getRangeRect(); if (!rect) return; setEmojiPosition({ top: rect.top, left: rect.left }); }, 50); } },
      { label: t('document.slashMenu.name.file'), key: 'file', icon: ICONS.file, keywords: ['file', 'upload'], onClick: () => { turnInto(BlockType.FileBlock, {}); } },
    ].filter((option) => {
      if (option.disabled) return false;
      if (!searchText) return true;
      return option.keywords.some((kw) => kw.toLowerCase().includes(searchText.toLowerCase()));
    });
  }, [t, chars, getBeforeContent, askAIAnything, continueWriting, turnInto, openPanel, documentId, addPage, openPageModal, setEmojiPosition, searchText, handleOpenLinkedDatabasePicker, editor]);

  const resultLength = options.length;
  const countRef = useRef(0);

  // Scroll selected item into view
  useEffect(() => {
    selectedOptionRef.current = selectedOption;
    if (!selectedOption) return;
    const el = optionsRef.current?.querySelector(`[data-option-key="${selectedOption}"]`) as HTMLButtonElement | null;
    if (el && optionsRef.current) {
      const menu = optionsRef.current;
      if (el.offsetTop < menu.scrollTop) { menu.scrollTop = el.offsetTop; }
      else if (el.offsetTop + el.offsetHeight > menu.scrollTop + menu.clientHeight) { menu.scrollTop = el.offsetTop + el.offsetHeight - menu.clientHeight; }
    }
  }, [selectedOption]);

  // Select first option when opening
  useEffect(() => {
    if (!open || options.length === 0) return;
    setSelectedOption(options[0].key);
  }, [open, options]);

  // Auto-close if no results for 2+ keystrokes
  useEffect(() => {
    if (!open) return;
    if (searchText && resultLength === 0) { countRef.current += 1; } else { countRef.current = 0; }
    if (countRef.current > 1) { closePanel(); countRef.current = 0; }
  }, [closePanel, open, resultLength, searchText]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!open) return;
      switch (e.key) {
        case 'Enter':
          e.stopPropagation(); e.preventDefault();
          if (selectedOptionRef.current) { handleSelectOption(selectedOptionRef.current); options.find((o) => o.key === selectedOptionRef.current)?.onClick?.(); }
          break;
        case 'ArrowUp': case 'ArrowDown': {
          e.stopPropagation(); e.preventDefault();
          const index = options.findIndex((o) => o.key === selectedOptionRef.current);
          const nextIndex = e.key === 'ArrowDown' ? (index + 1) % options.length : (index - 1 + options.length) % options.length;
          setSelectedOption(options[nextIndex].key);
          break;
        }
      }
    };
    const slateDom = ReactEditor.toDOMNode(editor, editor);
    slateDom.addEventListener('keydown', handleKeyDown);
    return () => slateDom.removeEventListener('keydown', handleKeyDown);
  }, [closePanel, editor, open, options, handleSelectOption]);

  // Clear selection when options empty
  useEffect(() => { if (options.length > 0) return; setSelectedOption(null); }, [options.length]);

  // Calculate popover origins
  useEffect(() => {
    if (open && panelPosition) {
      const origins = calculateOptimalOrigins(panelPosition, 320, 400, undefined, 16);
      const isAlignBottom = origins.transformOrigin.vertical === 'bottom';
      setTransformOrigin(isAlignBottom ? origins.transformOrigin : { vertical: -30, horizontal: origins.transformOrigin.horizontal });
    }
  }, [open, panelPosition]);

  useEffect(() => {
    if (!linkedPicker) return;
    const origins = calculateOptimalOrigins(linkedPicker.position, 360, 360, undefined, 16);
    setLinkedTransformOrigin(origins.transformOrigin);
  }, [linkedPicker]);

  useEffect(() => { if (!linkedPicker) setDatabaseSearch(''); }, [linkedPicker]);

  return {
    open, panelPosition, transformOrigin, closePanel,
    options, selectedOption, optionsRef, handleSelectOption,
    linkedPicker, linkedTransformOrigin, databaseSearch, setDatabaseSearch,
    databaseLoading, databaseError, filteredDatabaseTree, allowedDatabaseIds,
    handleSelectDatabase, closeLinkedPicker: () => setLinkedPicker(null),
  };
}
