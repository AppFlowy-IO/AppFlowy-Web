import { IconButton, Tooltip } from '@mui/material';
import React, { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Transforms } from 'slate';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { CONTAINER_BLOCK_TYPES } from '@/application/slate-yjs/command/const';
import { filterValidNodes, findSlateEntryByBlockId, getSelectedPaths } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { ReactComponent as DragSvg } from '@/assets/icons/drag.svg';
import { ReactComponent as AddSvg } from '@/assets/icons/plus.svg';
import { useBlockDrag } from '@/components/editor/components/drag-drop/useBlockDrag';
import { usePanelContext } from '@/components/editor/components/panels/Panels.hooks';
import { PanelType } from '@/components/editor/components/panels/PanelsContext';
import ControlsMenu from '@/components/editor/components/toolbar/block-controls/ControlsMenu';
import { getRangeRect } from '@/components/editor/components/toolbar/selection-toolbar/utils';
import { useEditorContext } from '@/components/editor/EditorContext';
import { isMac } from '@/utils/hotkeys';

type ControlActionsProps = {
  blockId: string | null;
  parentId?: string | null;
  setOpenMenu?: (open: boolean) => void;
  onDraggingChange?: (dragging: boolean) => void;
};

function ControlActions({ setOpenMenu, blockId, parentId, onDraggingChange }: ControlActionsProps) {
  const { setSelectedBlockIds } = useEditorContext();
  const [menuAnchorEl, setMenuAnchorEl] = useState<HTMLElement | null>(null);
  const openMenu = Boolean(menuAnchorEl);
  const dragHandleRef = useRef<HTMLButtonElement | null>(null);

  const editor = useSlateStatic() as YjsEditor;
  const { t } = useTranslation();

  const {
    openPanel,
  } = usePanelContext();

  const onAdded = useCallback(() => {
    setTimeout(() => {
      const rect = getRangeRect();

      if (!rect) return;

      openPanel(PanelType.Slash, { top: rect.top, left: rect.left });
    }, 50);

  }, [openPanel]);

  const onClickOptions = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!blockId) return;
    setOpenMenu?.(true);
    setMenuAnchorEl(e.currentTarget as HTMLElement);
    const { selection } = editor;
    const entry = findSlateEntryByBlockId(editor, blockId);

    if(!entry) return;

    const [, nodePath] = entry;

    if (!selection) {
      setSelectedBlockIds?.([blockId]);
    } else {
      const selectedPaths = getSelectedPaths(editor);

      if (!selectedPaths || selectedPaths.length === 0) {
        setSelectedBlockIds?.([blockId]);
      } else {
        const nodes = filterValidNodes(editor, selectedPaths);
        const blockIds = nodes.map(([node]) => node.blockId as string);

        if (blockIds.includes(blockId)) {
          setSelectedBlockIds?.(blockIds);
        } else {
          setSelectedBlockIds?.([blockId]);
        }
      }
    }

    editor.select(editor.start(nodePath));

  }, [setOpenMenu, editor, blockId, setSelectedBlockIds]);

  const onClickAdd = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    if (!blockId) return;
    const entry = findSlateEntryByBlockId(editor, blockId);

    if(!entry) return;

    const [node, path] = entry;

    const start = editor.start(path);

    ReactEditor.focus(editor);
    Transforms.select(editor, start);

    const type = node.type as BlockType;

    if (CustomEditor.getBlockTextContent(node, 2) === '' && [...CONTAINER_BLOCK_TYPES, BlockType.HeadingBlock].includes(type)) {
      onAdded();
      return;
    }

    if (e.altKey) {
      CustomEditor.addAboveBlock(editor, blockId, BlockType.Paragraph, {});
    } else {
      CustomEditor.addBelowBlock(editor, blockId, BlockType.Paragraph, {});
    }

    onAdded();
  }, [editor, blockId, onAdded]);

  const { isDragging } = useBlockDrag({
    blockId: blockId ?? undefined,
    parentId: parentId ?? undefined,
    dragHandleRef,
    disabled: openMenu,
    onDragChange: onDraggingChange,
  });

  return (
    <div className={'gap-1 flex w-full flex-grow transform items-center justify-end'}>
      <Tooltip
        title={<div className={'flex flex-col items-center justify-center text-center'}>
          <div>{t('blockActions.addBelowTooltip')}</div>
          <div>{`${isMac() ? t('blockActions.addAboveMacCmd') : t('blockActions.addAboveCmd')} ${t('blockActions.addAboveTooltip')}`}</div>
        </div>}
        disableInteractive={true}
      >
        <IconButton
          onClick={onClickAdd}
          size={'small'}
          data-testid={'add-block'}
        >
          <AddSvg/>
        </IconButton>
      </Tooltip>
      <Tooltip
        title={<div className={'flex flex-col items-center justify-center text-center'}>
          <div>{t('blockActions.dragTooltip')}</div>
          <div>{t('blockActions.openMenuTooltip')}</div>
        </div>}
        disableInteractive={true}
      >
        <IconButton
          ref={dragHandleRef}
          size={'small'}
          data-testid={'drag-block'}
          onClick={onClickOptions}
          className={`${isDragging ? 'cursor-grabbing opacity-70' : 'cursor-grab'}`}
          onMouseDown={(event) => {
            event.stopPropagation();
          }}
        >
          <DragSvg />
        </IconButton>
      </Tooltip>
      {blockId && openMenu && <ControlsMenu
        open={openMenu}
        anchorEl={menuAnchorEl}
        onClose={() => {
          setSelectedBlockIds?.([]);
          setMenuAnchorEl(null);
          setOpenMenu?.(false);
        }}
      />}
    </div>
  );
}

export default ControlActions;
