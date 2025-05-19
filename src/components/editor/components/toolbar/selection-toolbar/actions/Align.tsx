import Button from '@mui/material/Button';
import { PopoverProps } from '@mui/material/Popover';
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
import { Popover } from '@/components/_shared/popover';
import { useSelectionToolbarContext } from '@/components/editor/components/toolbar/selection-toolbar/SelectionToolbar.hooks';

import { useKeyboardNavigation } from '../hooks/useKeyboardNavigation';

import ActionButton from './ActionButton';

const popoverProps: Partial<PopoverProps> = {
  anchorOrigin: {
    vertical: 'bottom',
    horizontal: 'center',
  },
  transformOrigin: {
    vertical: -8,
    horizontal: 'center',
  },
  slotProps: {
    paper: {
      className: 'bg-[var(--surface-primary)] rounded-[6px]',
    },
  },
};

const alignOptions = [
  {
    icon: <AlignLeftSvg className="h-5 w-5" />,
    labelKey: 'toolbar.alignLeft',
    type: AlignType.Left,
  },
  {
    icon: <AlignCenterSvg className="h-5 w-5" />,
    labelKey: 'toolbar.alignCenter',
    type: AlignType.Center,
  },
  {
    icon: <AlignRightSvg className="h-5 w-5" />,
    labelKey: 'toolbar.alignRight',
    type: AlignType.Right,
  },
];

export function Align({ blockId, enabled = true }: { blockId?: string; enabled?: boolean }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement | null>(null);
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const { rePosition } = useSelectionToolbarContext();

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
  }, []);

  const handleOpen = useCallback(() => {
    setOpen(true);
  }, []);

  const activeIcon = useCallback(() => {
    const align = getAlign();
    const option = alignOptions.find(opt => opt.type === align) || alignOptions[0];

    return cloneElement(option.icon, {
      className: `h-5 w-5 ${align ? 'text-fill-default' : ''}`
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

      <Popover
        keepMounted={false}
        disableAutoFocus={true}
        disableEnforceFocus={true}
        disableRestoreFocus={true}
        onClose={handleClose}
        open={open && enabled}
        anchorEl={ref.current}
        {...popoverProps}
      >
        <div className="flex flex-col w-[200px] rounded-[12px]" style={{ padding: 'var(--spacing-spacing-m)' }}>
          {alignOptions.map((option, index) => (
            <Button
              key={option.labelKey}
              {...getButtonProps(index)}
              startIcon={option.icon}
              color="inherit"
              onClick={() => {
                toggleAlign(option.type)();
                setOpen(false);
              }}
              className="text-foreground"
              disableRipple
              sx={{
                '.MuiButton-startIcon': {
                  margin: 0,
                  marginRight: 'var(--spacing-spacing-m)'
                },
                padding: '0 var(--spacing-spacing-m)',
                height: '32px',
                minHeight: '32px',
                borderRadius: '8px',
                justifyContent: 'flex-start',
                textAlign: 'left',
                fontWeight: 400,
                ...(getAlign() === option.type && {
                  backgroundColor: 'var(--fill-list-active)'
                }),
                ...(selectedIndex === index && {
                  backgroundColor: 'var(--fill-list-hover)'
                })
              }}
            >
              {t(option.labelKey as any)}
            </Button>
          ))}
        </div>
      </Popover>
    </>
  );
}

export default Align;
