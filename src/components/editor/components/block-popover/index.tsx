import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { calculateOptimalOrigins, Origins, Popover } from '@/components/_shared/popover';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import FileBlockPopoverContent from '@/components/editor/components/block-popover/FileBlockPopoverContent';
import ImageBlockPopoverContent from '@/components/editor/components/block-popover/ImageBlockPopoverContent';
import { useEditorContext } from '@/components/editor/EditorContext';

import MathEquationPopoverContent from './MathEquationPopoverContent';
import VideoBlockPopoverContent from './VideoBlockPopoverContent';

const defaultOrigins: Origins = {
  anchorOrigin: {
    vertical: 'bottom',
    horizontal: 'center',
  },
  transformOrigin: {
    vertical: 'top',
    horizontal: 'center',
  },
};

function BlockPopover() {
  const { open, anchorEl, close, type, blockId } = usePopoverContext();
  const { setSelectedBlockIds } = useEditorContext();
  const editor = useSlateStatic() as YjsEditor;
  const [origins, setOrigins] = React.useState<Origins>(defaultOrigins);

  const handleClose = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    if (!blockId) return;

    const entry = findSlateEntryByBlockId(editor, blockId);

    if(!entry) return;

    const [, path] = entry;

    editor.select(editor.start(path));
    ReactEditor.focus(editor);
    close();
  }, [blockId, close, editor]);

  const content = useMemo(() => {
    if (!blockId) return;
    switch (type) {
      case BlockType.FileBlock:
        return <FileBlockPopoverContent blockId={blockId} onClose={handleClose} />;
      case BlockType.ImageBlock:
        return <ImageBlockPopoverContent blockId={blockId} onClose={handleClose} />;
      case BlockType.EquationBlock:
        return <MathEquationPopoverContent blockId={blockId} onClose={handleClose} />;
      case BlockType.VideoBlock:
        return <VideoBlockPopoverContent blockId={blockId} onClose={handleClose} />;
      default:
        return null;
    }
  }, [type, blockId, handleClose]);

  const paperRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (blockId) {
      setSelectedBlockIds?.([blockId]);
    } else {
      setSelectedBlockIds?.([]);
    }
  }, [blockId, setSelectedBlockIds]);

  useEffect(() => {
    if (!open) return;
    editor.deselect();
  }, [open, editor]);

  useEffect(() => {
    const panelPosition = anchorEl?.getBoundingClientRect();

    if (open && panelPosition) {
      const origins = calculateOptimalOrigins(
        {
          top: panelPosition.bottom,
          left: panelPosition.left,
        },
        400,
        type === BlockType.ImageBlock || type === BlockType.VideoBlock ? 366 : 200,
        defaultOrigins,
        16
      );

      setOrigins({
        transformOrigin: {
          vertical: origins.transformOrigin.vertical,
          horizontal: 'center',
        },
        anchorOrigin: {
          vertical: origins.anchorOrigin.vertical,
          horizontal: 'center',
        },
      });
    }
  }, [open, anchorEl, type]);

  return (
    <Popover
      open={open}
      onClose={handleClose}
      anchorEl={anchorEl}
      adjustOrigins={false}
      slotProps={{
        paper: {
          ref: paperRef,
          className: 'w-[400px] max-h-[366px]',
        },
      }}
      {...origins}
      disableRestoreFocus={true}
    >
      {content}
    </Popover>
  );
}

export default BlockPopover;
