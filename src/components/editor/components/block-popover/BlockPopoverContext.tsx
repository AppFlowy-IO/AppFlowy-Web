import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { ReactEditor } from 'slate-react';

import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';

export interface BlockPopoverContextType {
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
  const [type, setType] = useState<BlockType | undefined>();
  const [blockId, setBlockId] = useState<string | undefined>();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const pendingRef = useRef<{ blockId: string; type: BlockType } | null>(null);
  const open = Boolean(anchorEl);

  const close = useCallback(() => {
    setAnchorEl(null);
    setBlockId(undefined);
    setType(undefined);
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
        setBlockId(targetBlockId);
        setType(targetType);
        setAnchorEl(dom);
        return;
      }

      pendingRef.current = { blockId: targetBlockId, type: targetType };
    },
    [resolveAnchor]
  );

  const notifyMount = useCallback(
    (mountedBlockId: string) => {
      const pending = pendingRef.current;

      if (!pending || pending.blockId !== mountedBlockId) return;

      const dom = resolveAnchor(pending.blockId);

      if (!dom) return;

      pendingRef.current = null;
      setBlockId(pending.blockId);
      setType(pending.type);
      setAnchorEl(dom);
    },
    [resolveAnchor]
  );

  const isOpen = useCallback(
    (popover: BlockType) => {
      return popover === type;
    },
    [type]
  );

  const contextValue = useMemo(
    () => ({ blockId, type, anchorEl, open, close, openPopover, notifyMount, isOpen }),
    [blockId, type, anchorEl, open, close, openPopover, notifyMount, isOpen]
  );

  return <BlockPopoverContext.Provider value={contextValue}>{children}</BlockPopoverContext.Provider>;
};
