import { PopoverActions } from '@mui/material/Popover';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { calculateOptimalOrigins, Origins, Popover } from '@/components/_shared/popover';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { useEditorLocalState } from '@/components/editor/EditorContext';

import MathEquationPopoverContent from './MathEquationPopoverContent';

const AudioBlockPopoverContent = lazy(() => import('./AudioBlockPopoverContent'));
const FileBlockPopoverContent = lazy(() => import('./FileBlockPopoverContent'));
const GalleryBlockPopoverContent = lazy(() => import('./GalleryBlockPopoverContent'));
const GoogleDriveBlockPopoverContent = lazy(() => import('./GoogleDriveBlockPopoverContent'));
const ImageBlockPopoverContent = lazy(() => import('./ImageBlockPopoverContent'));
const LinkPreviewPopoverContent = lazy(() => import('./LinkPreviewPopoverContent'));
const PDFBlockPopoverContent = lazy(() => import('./PDFBlockPopoverContent'));
const VideoBlockPopoverContent = lazy(() => import('./VideoBlockPopoverContent'));

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
  const { setSelectedBlockIds } = useEditorLocalState();
  const editor = useSlateStatic() as YjsEditor;
  const mediaPicker =
    type === BlockType.PDFBlock || type === BlockType.ImageBlock || type === BlockType.GoogleDriveBlock;
  const [origins, setOrigins] = useState<Origins>(defaultOrigins);

  const handleClose = useCallback(() => {
    window.getSelection()?.removeAllRanges();
    if (!blockId) return;

    const entry = findSlateEntryByBlockId(editor, blockId);

    if (!entry) { close(); return; }

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
      case BlockType.PDFBlock:
        return <PDFBlockPopoverContent blockId={blockId} onClose={handleClose} />;
      case BlockType.ImageBlock:
        return <ImageBlockPopoverContent key={blockId} blockId={blockId} onClose={handleClose} />;
      case BlockType.EquationBlock:
        return <MathEquationPopoverContent blockId={blockId} onClose={handleClose} />;
      case BlockType.VideoBlock:
        return <VideoBlockPopoverContent blockId={blockId} onClose={handleClose} />;
      case BlockType.LinkPreview:
        return <LinkPreviewPopoverContent blockId={blockId} onClose={handleClose} />;
      case BlockType.GalleryBlock:
        return <GalleryBlockPopoverContent blockId={blockId} onClose={handleClose} />;
      case BlockType.AudioBlock:
        return <AudioBlockPopoverContent blockId={blockId} onClose={handleClose} />;
      case BlockType.GoogleDriveBlock:
        // A new target owns a fresh draft, replacement guard, and account picker.
        return <GoogleDriveBlockPopoverContent key={blockId} blockId={blockId} onClose={handleClose} />;
      default:
        return null;
    }
  }, [type, blockId, handleClose]);

  const [paper, setPaper] = useState<HTMLDivElement | null>(null);
  const popoverActions = useRef<PopoverActions>(null);

  useEffect(() => {
    if (!open || !mediaPicker || !paper) return;
    // The lazy picker initially has no height. Reposition after it loads and
    // whenever switching tabs or resizing changes its measured dimensions.
    const observer = new ResizeObserver(() => popoverActions.current?.updatePosition());

    observer.observe(paper);
    return () => observer.disconnect();
  }, [open, mediaPicker, paper]);

  useEffect(() => {
    // Desktop keeps media placeholders in its neutral active state while
    // uploading; whole-block selection belongs to the six-dot action menu.
    if (blockId && !mediaPicker) {
      setSelectedBlockIds?.([blockId]);
    } else {
      setSelectedBlockIds?.([]);
    }
  }, [blockId, mediaPicker, setSelectedBlockIds]);

  useEffect(() => {
    if (!open) return;
    // Keyboard conversion can focus the TeX input while Slate is updating its
    // selection. Slate ignores blur events during that update, so explicitly
    // release its focus state when handing editing over to the popover.
    if (type === BlockType.EquationBlock) ReactEditor.blur(editor);
    editor.deselect();
  }, [open, editor, type]);

  useEffect(() => {
    const panelPosition = anchorEl?.getBoundingClientRect();

    if (open && panelPosition) {
      const origins = calculateOptimalOrigins(
        {
          top: panelPosition.bottom,
          left: panelPosition.left,
        },
        400,
        [
          BlockType.ImageBlock,
          BlockType.VideoBlock,
          BlockType.GalleryBlock,
          BlockType.AudioBlock,
          BlockType.GoogleDriveBlock,
        ].includes(type as BlockType)
          ? 366
          : type === BlockType.PDFBlock ? 347 : 200,
        defaultOrigins,
        16
      );

      setOrigins({
        transformOrigin: {
          vertical: origins.transformOrigin.vertical,
          horizontal: 'center',
        },
        anchorOrigin: {
          vertical: mediaPicker && origins.anchorOrigin.vertical === 'top'
            ? -4
            : mediaPicker && origins.anchorOrigin.vertical === 'bottom'
            ? panelPosition.height + 4
            : origins.anchorOrigin.vertical,
          horizontal: 'center',
        },
      });
    }
  }, [open, anchorEl, type, mediaPicker]);

  return (
    <Popover
      open={open}
      onClose={handleClose}
      anchorEl={anchorEl}
      action={mediaPicker ? popoverActions : undefined}
      adjustOrigins={false}
      slotProps={{
        paper: {
          ref: setPaper,
          className: `w-[400px] ${mediaPicker ? '!max-h-[calc(100dvh-32px)] !rounded-lg !bg-surface-layer-04 !shadow-[0_2px_16px_#0000001f]' : 'max-h-[366px]'} ${type === BlockType.EquationBlock ? 'math-equation-popover !rounded-xl !bg-surface-layer-04' : ''}`,
        },
      }}
      {...origins}
      // Google Picker owns a portal outside this popover and manages its own focus.
      disableEnforceFocus={type === BlockType.GoogleDriveBlock}
      disableRestoreFocus={true}
    >
      <Suspense fallback={null}>{content}</Suspense>
    </Popover>
  );
}

export default BlockPopover;
