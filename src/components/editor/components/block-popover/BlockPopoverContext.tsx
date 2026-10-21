import React, { createContext, useCallback, useContext, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { flushSync } from 'react-dom';
import { ReactEditor } from 'slate-react';

import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { OPEN_MATH_EQUATION_EVENT } from '@/components/editor/utils/math-equation';


export type MathEquationAIAction = 'generate' | 'explain' | 'check';
export interface MathEquationAISession { blockId: string; action: MathEquationAIAction; draft?: string; id?: number }

export interface BlockPopoverContextType {
  mathEquationAI?: MathEquationAISession;
  openMathEquationAI?: (session: MathEquationAISession) => void;
  closeMathEquationAI?: () => void;
  type?: BlockType;
  blockId?: string;
  anchorEl?: HTMLElement | null;
  open: boolean;
  close: () => void;
  openPopover: (blockId: string, type: BlockType, anchorEl?: HTMLElement | null) => void;
  notifyMount: (blockId: string) => void;
  isOpen: (type: BlockType) => boolean;
}

export const BlockPopoverContext = createContext<BlockPopoverContextType | undefined>(undefined);

export function usePopoverContext() {
  const context = useContext(BlockPopoverContext);

  if (!context) {
    throw new Error('usePopoverContext must be used within a BlockPopoverProvider');
  }

  return context;
}

export function usePopoverMountSignal(blockId: string | undefined) {
  const { notifyMount } = usePopoverContext();

  useEffect(() => {
    if (!blockId) return;
    notifyMount(blockId);
  }, [blockId, notifyMount]);
}

export const BlockPopoverProvider = ({ children, editor }: { children: React.ReactNode; editor: ReactEditor }) => {
  const [mathEquationAI, setMathEquationAI] = useState<MathEquationAISession>();
  const sessionId = useRef(0);
  const openMathEquationAI = useCallback((session: MathEquationAISession) => setMathEquationAI({ ...session, id: ++sessionId.current }), []);
  const closeMathEquationAI = useCallback(() => setMathEquationAI(undefined), []);
  const [type, setType] = useState<BlockType | undefined>();
  const [blockId, setBlockId] = useState<string | undefined>();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const [pendingMathId, setPendingMathId] = useState<string>();
  const pendingRef = useRef<{ blockId: string; type: BlockType } | null>(null);
  const open = Boolean(anchorEl);

  const close = useCallback(() => {
    setAnchorEl(null);
    setBlockId(undefined);
    setType(undefined);
    setPendingMathId(undefined);
    pendingRef.current = null;
  }, []);

  const resolveAnchor = useCallback(
    (targetBlockId: string): HTMLElement | null => {
      const entry = findSlateEntryByBlockId(editor, targetBlockId);

      if (!entry) return null;

      try {
        return ReactEditor.toDOMNode(editor, entry[0]);
      } catch {
        return null;
      }
    },
    [editor]
  );

  const openPopover = useCallback(
    (targetBlockId: string, targetType: BlockType) => {
      const dom = resolveAnchor(targetBlockId);

      if (dom) {
        pendingRef.current = null;
        setPendingMathId(undefined);
        setBlockId(targetBlockId);
        setType(targetType);
        setAnchorEl(dom);
        return;
      }

      pendingRef.current = { blockId: targetBlockId, type: targetType };
    },
    [resolveAnchor]
  );

  // Resolve keyboard requests after the converted block's DOM has committed.
  // Retry on later commits too: Slate can replace its DOM mapping without
  // changing the block ID (and thus without another mount notification).
  useLayoutEffect(() => {
    if (pendingMathId) openPopover(pendingMathId, BlockType.EquationBlock);
  });

  useEffect(() => {
    let mounted = true;
    const handleOpen = (event: Event) => {
      const detail = (event as CustomEvent<{ editor: ReactEditor; blockId: string }>).detail;

      if (detail.editor !== editor) return;
      // Let Slate finish the shortcut's model update, then mount and focus the
      // popover before the next keystroke can land in the old document input.
      queueMicrotask(() => {
        if (mounted) flushSync(() => setPendingMathId(detail.blockId));
      });
    };

    window.addEventListener(OPEN_MATH_EQUATION_EVENT, handleOpen);
    return () => {
      mounted = false;
      window.removeEventListener(OPEN_MATH_EQUATION_EVENT, handleOpen);
    };
  }, [editor]);

  const notifyMount = useCallback(
    (mountedBlockId: string) => {
      const pending = pendingRef.current;

      if (!pending || pending.blockId !== mountedBlockId) return;

      openPopover(pending.blockId, pending.type);
    },
    [openPopover]
  );

  const isOpen = useCallback(
    (popover: BlockType) => {
      return popover === type;
    },
    [type]
  );

  const contextValue = useMemo(
    () => ({ blockId, type, anchorEl, open, close, openPopover, notifyMount, isOpen, mathEquationAI, openMathEquationAI, closeMathEquationAI }),
    [blockId, type, anchorEl, open, close, openPopover, notifyMount, isOpen, mathEquationAI, openMathEquationAI, closeMathEquationAI]
  );

  return <BlockPopoverContext.Provider value={contextValue}>{children}</BlockPopoverContext.Provider>;
};
