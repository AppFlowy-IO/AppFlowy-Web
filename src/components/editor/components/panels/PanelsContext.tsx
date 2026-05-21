import React, { createContext, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { BaseRange, Editor, Element, Point } from 'slate';
import { TextInsertTextOptions } from 'slate/dist/interfaces/transforms/text';
import { ReactEditor } from 'slate-react';

import { SOFT_BREAK_TYPES } from '@/application/slate-yjs/command/const';
import { BlockType } from '@/application/types';
import { PASTE_AS_MENU_EVENT } from '@/components/editor/components/panels/paste-as-panel/constants';
import type { PasteAsMenuPayload } from '@/components/editor/components/panels/paste-as-panel/constants';
import { getRangeRect } from '@/components/editor/components/toolbar/selection-toolbar/utils';

export enum PanelType {
  Slash = 'slash',
  Mention = 'mention',
  PageReference = 'pageReference',
  PasteAs = 'pasteAs',
}

export interface PanelContextType {
  activePanel?: PanelType;
  panelPosition?: { top: number; left: number };
  setActivePanel: (panel: PanelType) => void;
  closePanel: () => void;
  openPanel: (panel: PanelType, position: { top: number; left: number }) => void;
  isPanelOpen: (panel: PanelType) => boolean;
  searchText?: string;
  removeContent: () => void;
  getPasteAsPayload: () => PasteAsMenuPayload | undefined;
}

export const PanelContext = createContext<PanelContextType | undefined>(undefined);

const panelTypeByTrigger: Record<string, PanelType> = {
  '/': PanelType.Slash,
  '+': PanelType.PageReference,
  '@': PanelType.Mention,
};

const panelTypeChars = Object.keys(panelTypeByTrigger);

function getPanelPosition(editor: ReactEditor, selection: BaseRange) {
  const rect = getRangeRect();

  if (rect) return { top: rect.top, left: rect.left };

  try {
    const domRange = ReactEditor.toDOMRange(editor, selection);
    const domRect = domRange.getBoundingClientRect();

    return { top: domRect.top, left: domRect.left };
  } catch {
    const editorRect = ReactEditor.toDOMNode(editor, editor).getBoundingClientRect();

    return { top: editorRect.top, left: editorRect.left };
  }
}

export const PanelProvider = ({ children, editor }: { children: React.ReactNode; editor: ReactEditor }) => {
  const [activePanel, setActivePanel] = useState<PanelType | undefined>(undefined);
  const [panelPosition, setPanelPosition] = useState<{ top: number; left: number } | undefined>(undefined);
  const startSelection = useRef<BaseRange | null>(null);
  const endSelection = useRef<BaseRange | null>(null);
  const [searchText, setSearchText] = useState('');
  const openRef = useRef(false);
  const activePanelRef = useRef<PanelType | undefined>(undefined);
  const pasteAsPayloadRef = useRef<PasteAsMenuPayload | undefined>(undefined);

  useEffect(() => {
    openRef.current = activePanel !== undefined;
    activePanelRef.current = activePanel;
  }, [activePanel]);

  const closePanel = useCallback(() => {
    openRef.current = false;
    activePanelRef.current = undefined;
    setActivePanel(undefined);
    startSelection.current = null;
    endSelection.current = null;
    pasteAsPayloadRef.current = undefined;
    setSearchText('');
  }, []);

  const removeContent = useCallback(() => {
    const { selection } = editor;

    if (!selection) return;

    const start = startSelection.current?.anchor;
    const end = endSelection.current?.focus;

    if (!start || !end) return;
    const length = end.offset - start.offset;

    if (length === 0) return;
    editor.delete({
      at: {
        anchor: start,
        focus: end,
      },
    });
  }, [editor]);

  const openPanel = useCallback(
    (panel: PanelType, position: { top: number; left: number }) => {
      openRef.current = true;
      activePanelRef.current = panel;
      setActivePanel(panel);
      setPanelPosition(position);
      pasteAsPayloadRef.current = undefined;
      const { selection } = editor;

      if (!selection) return;
      startSelection.current = editor.selection;
      endSelection.current = editor.selection;
    },
    [editor]
  );

  const isSlashPanelBlocked = useCallback(
    (selection: BaseRange) => {
      const inNonPanelBlock = Editor.above(editor, {
        at: selection,
        match: (n) =>
          !Editor.isEditor(n) &&
          Element.isElement(n) &&
          (SOFT_BREAK_TYPES.includes(n.type as BlockType) ||
            n.type === BlockType.AIMeetingTranscriptionBlock ||
            n.type === BlockType.AIMeetingSpeakerBlock),
      });

      return Boolean(inNonPanelBlock);
    },
    [editor]
  );

  const openTriggerPanel = useCallback(
    (panelType: PanelType, triggerLength = 1) => {
      const { selection } = editor;

      if (!selection) return;
      if (panelType === PanelType.Slash && isSlashPanelBlocked(selection)) return;

      const position = getPanelPosition(editor, selection);

      if (!position) return;

      openPanel(panelType, position);
      startSelection.current = {
        anchor: {
          path: selection.anchor.path,
          offset: Math.max(0, selection.anchor.offset - triggerLength),
        },
        focus: selection.focus,
      };
      endSelection.current = editor.selection;
    },
    [editor, isSlashPanelBlocked, openPanel]
  );

  useEffect(() => {
    const slateDom = ReactEditor.toDOMNode(editor, editor);
    const handlePasteAsMenu = (event: Event) => {
      const detail = (event as CustomEvent<PasteAsMenuPayload>).detail;

      if (!detail) return;

      const rect = detail.position ?? getRangeRect();

      if (!rect) return;

      pasteAsPayloadRef.current = detail;
      setActivePanel(PanelType.PasteAs);
      setPanelPosition({ top: rect.top, left: rect.left });
      setSearchText('');
      startSelection.current = detail.range;
      endSelection.current = detail.range;
    };

    slateDom.addEventListener(PASTE_AS_MENU_EVENT, handlePasteAsMenu);

    return () => {
      slateDom.removeEventListener(PASTE_AS_MENU_EVENT, handlePasteAsMenu);
    };
  }, [editor]);

  const isPanelOpen = useCallback(
    (panel: PanelType) => {
      return activePanel === panel;
    },
    [activePanel]
  );

  const getPasteAsPayload = useCallback(() => {
    return pasteAsPayloadRef.current;
  }, []);

  useEffect(() => {
    const { insertText } = editor;

    editor.insertText = (text: string, options?: TextInsertTextOptions) => {
      insertText(text, options);
      const { selection } = editor;

      if (!selection) return;
      if (openRef.current) return;

      if (panelTypeChars.includes(text)) {
        const panelType = panelTypeByTrigger[text];

        if (!panelType) return;
        openTriggerPanel(panelType);
        return;
      }

      const rangeText = editor.string({
        anchor: {
          path: selection.anchor.path,
          offset: selection.anchor.offset - 2,
        },
        focus: selection.focus,
      });

      if (rangeText === '[[') {
        openTriggerPanel(PanelType.PageReference, 2);
      }
    };

    return () => {
      editor.insertText = insertText;
    };
  }, [editor, openTriggerPanel]);

  useEffect(() => {
    const { onChange } = editor;

    editor.onChange = () => {
      onChange();
      if (!openRef.current) return;
      if (activePanelRef.current === PanelType.PasteAs) return;
      const { selection } = editor;
      let start = startSelection.current?.focus;

      if (!selection) return;

      if (!start) {
        startSelection.current = selection;
        start = selection.anchor;
      }

      const text = editor.string({
        anchor: start,
        focus: selection.focus,
      });

      if (Point.isBefore(selection.anchor, start)) {
        closePanel();
        return;
      }

      endSelection.current = selection;

      setSearchText(text.trim());
    };

    return () => {
      editor.onChange = onChange;
    };
  }, [editor, closePanel]);

  useEffect(() => {
    const slateDom = ReactEditor.toDOMNode(editor, editor);
    const handleKeyDown = (e: KeyboardEvent) => {
      const { key } = e;
      const target = e.target;

      if (!(target instanceof Node) || !slateDom.contains(target)) return;

      if (!openRef.current) {
        const panelType = panelTypeByTrigger[key];

        if (!panelType || e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;

        window.setTimeout(() => {
          if (!openRef.current) {
            openTriggerPanel(panelType);
          }
        }, 0);
        return;
      }

      switch (key) {
        case 'Escape':
          e.stopPropagation();
          closePanel();
          break;
        case 'Backspace': {
          const { selection } = editor;

          if (!selection || !startSelection.current) return;
          const text = editor.string({
            anchor: startSelection.current.focus,
            focus: selection?.focus,
          });

          if (text === '') {
            closePanel();
          }

          break;
        }

        default:
          break;
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);

    return () => {
      document.removeEventListener('keydown', handleKeyDown, true);
    };
  }, [closePanel, editor, openTriggerPanel]);

  const contextValue = useMemo(
    () => ({
      activePanel,
      setActivePanel,
      closePanel,
      openPanel,
      isPanelOpen,
      panelPosition,
      searchText,
      removeContent,
      getPasteAsPayload,
    }),
    [
      activePanel,
      closePanel,
      openPanel,
      isPanelOpen,
      panelPosition,
      searchText,
      removeContent,
      getPasteAsPayload,
    ]
  );

  return (
    <PanelContext.Provider value={contextValue}>
      {children}
    </PanelContext.Provider>
  );
};
