import { cloneElement, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Element } from 'slate';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId, getBlockEntry } from '@/application/slate-yjs/utils/editor';
import { AlignType, BlockData } from '@/application/types';
import { ReactComponent as AlignCenterSvg } from '@/assets/icons/align_center.svg';
import { ReactComponent as AlignLeftSvg } from '@/assets/icons/align_left.svg';
import { ReactComponent as AlignRightSvg } from '@/assets/icons/align_right.svg';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useSelectionToolbarContext } from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';

import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';
import ActionButton from './ActionButton';
import { MenuButton } from './MenuButton';

// Define allowed translation keys for align options
const alignLabelKeys = [
  'toolbar.alignLeft',
  'toolbar.alignCenter',
  'toolbar.alignRight',
] as const;

type AlignLabelKey = typeof alignLabelKeys[number];

const alignOptions = [
  {
    icon: <AlignLeftSvg className="h-5 w-5" />,
    labelKey: 'toolbar.alignLeft' as AlignLabelKey,
    type: AlignType.Left,
  },
  {
    icon: <AlignCenterSvg className="h-5 w-5" />,
    labelKey: 'toolbar.alignCenter' as AlignLabelKey,
    type: AlignType.Center,
  },
  {
    icon: <AlignRightSvg className="h-5 w-5" />,
    labelKey: 'toolbar.alignRight' as AlignLabelKey,
    type: AlignType.Right,
  },
];

export function Align({ blockId, enabled = true }: { blockId?: string; enabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const { rePosition, forceShow } = useSelectionToolbarContext();

  const getNode = useCallback(() => {
    let node: Element;

    if (!blockId) {
      node = getBlockEntry(editor)[0];
    } else {
      node = findSlateEntryByBlockId(editor, blockId)[0];
    }

    return node;
  }, [editor, blockId]);

  const getAlign = useCallback(() => {
    try {
      const node = getNode();

      return (node.data as BlockData).align;
    } catch (e) {
      return;
    }
  }, [getNode]);

  const handleClose = useCallback(() => {
    setOpen(false);
    forceShow(false);
  }, [forceShow]);

  const handleOpen = useCallback(() => {
    setOpen(true);
    forceShow(true);
  }, [forceShow]);

  const activeIcon = useCallback(() => {
    const align = getAlign();
    const option = alignOptions.find(opt => opt.type === align) || alignOptions[0];

    return cloneElement(option.icon, {
      className: 'h-5 w-5'
    });
  }, [getAlign]);

  const toggleAlign = useCallback(
    (align: AlignType) => {
      return () => {
        try {
          const node = getNode();

          CustomEditor.setBlockData(editor, node.blockId as string, { align });
          handleClose();
          rePosition();
        } catch (e) {
          return;
        }
      };
    },
    [getNode, editor, handleClose, rePosition]
  );

  const { getButtonProps, selectedIndex } = useKeyboardNavigation({
    itemCount: alignOptions.length,
    isOpen: open,
    onSelect: (index) => {
      toggleAlign(alignOptions[index].type)();
    },
    onClose: handleClose
  });

  useEffect(() => {
    if (!enabled) {
      setOpen(false);
    }
  }, [enabled]);

  return (
    <>
      <Popover open={open && enabled} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <ActionButton
            ref={ref}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              handleOpen();
            }}
            tooltip={t('document.plugins.optionAction.align')}
          >
            {activeIcon()}
          </ActionButton>
        </PopoverTrigger>
        <PopoverContent className="w-[200px] p-2" align="start" sideOffset={5}>
          <div className="flex flex-col gap-1">
            {alignOptions.map((option, index) => (
              <MenuButton
                key={option.labelKey}
                icon={option.icon}
                label={t(option.labelKey)}
                isActive={getAlign() === option.type}
                onClick={() => {
                  toggleAlign(option.type)();
                  handleClose();
                }}
                selected={selectedIndex === index}
                buttonProps={getButtonProps(index)}
              />
            ))}
          </div>
        </PopoverContent>
      </Popover>
    </>
  );
}

export default Align;
