import React, { createContext, useState, useCallback, useContext, useMemo } from 'react';
import { ReactEditor } from 'slate-react';

import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';

export interface BlockPopoverContextType {
  type?: BlockType;
  blockId?: string;
  anchorEl?: HTMLElement | null;
  open: boolean;
  close: () => void;
  openPopover: (blockId: string, type: BlockType, anchorEl: HTMLElement) => void;
  isOpen: (type: BlockType) => boolean;
}

export const BlockPopoverContext = createContext<BlockPopoverContextType>({
  open: false,
  close: () => {
    //
  },
  openPopover: () => {
    //
  },
  isOpen: () => false,
});

export function usePopoverContext() {
  return useContext(BlockPopoverContext);
}

export const BlockPopoverProvider = ({ children, editor }: { children: React.ReactNode; editor: ReactEditor }) => {
  const [type, setType] = useState<BlockType | undefined>();
  const [blockId, setBlockId] = useState<string | undefined>();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const close = useCallback(() => {
    setAnchorEl(null);
    setBlockId(undefined);
    setType(undefined);
  }, []);

  const openPopover = useCallback((blockId: string, type: BlockType) => {
    const entry = findSlateEntryByBlockId(editor, blockId);

    if (!entry) {
      console.error('Block not found');
      return;
    }

    const [node] = entry;
    const dom = ReactEditor.toDOMNode(editor, node);

    setBlockId(blockId);
    setType(type);
    setAnchorEl(dom);
  }, [editor]);

  const isOpen = useCallback((popover: BlockType) => {
    return popover === type;
  }, [type]);

  const contextValue = useMemo(
    () => ({ blockId, type, anchorEl, open, close, openPopover, isOpen }),
    [blockId, type, anchorEl, open, close, openPopover, isOpen]
  );

  return (
    <BlockPopoverContext.Provider value={contextValue}>
      {children}
    </BlockPopoverContext.Provider>
  );

};
