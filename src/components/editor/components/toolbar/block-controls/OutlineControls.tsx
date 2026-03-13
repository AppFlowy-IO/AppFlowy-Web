import { useCallback, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { ReactComponent as ChevronRightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { ReactComponent as CollapseIcon } from '@/assets/icons/collapse.svg';
import { ReactComponent as ExpandIcon } from '@/assets/icons/expand.svg';
import { ReactComponent as HashtagIcon } from '@/assets/icons/hashtag.svg';
import { ReactComponent as CheckIcon } from '@/assets/icons/tick.svg';
import { Origins, Popover } from '@/components/_shared/popover';
import { OutlineNode } from '@/components/editor/editor.type';
import { useEditorLocalState } from '@/components/editor/EditorContext';
import { Button } from '@/components/ui/button';

const origins: Origins = {
  anchorOrigin: {
    vertical: 'top',
    horizontal: 'right',
  },
  transformOrigin: {
    vertical: 'top',
    horizontal: 'left',
  },
};

export function OutlineDepthControl({ node, onClose }: { node: OutlineNode; onClose: () => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLButtonElement>(null);
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const blockId = node.blockId;
  const [originalDepth, setOriginalDepth] = useState<number>(node.data.depth || 1);

  const handleDepthChange = useCallback(
    (depth: number) => {
      if (depth === originalDepth) return;
      CustomEditor.setBlockData(editor, blockId, {
        depth,
      });
      setOriginalDepth(depth);
    },
    [blockId, editor, originalDepth]
  );

  return (
    <>
      <Button
        ref={ref}
        size='sm'
        variant='ghost'
        className={'justify-start px-1'}
        onClick={() => {
          setOpen(true);
        }}
      >
        <HashtagIcon className='h-5 w-5' />
        {t('document.plugins.outline.depthCustomization')}
        <ChevronRightIcon className='ml-auto h-5 w-5 text-icon-tertiary' />
      </Button>
      <Popover
        open={open}
        anchorEl={ref.current}
        onClose={() => {
          setOpen(false);
          onClose();
        }}
        {...origins}
      >
        <div className={'flex w-[120px] flex-col p-2'}>
          {[1, 2, 3, 4, 5, 6].map((depth) => {
            const isSelected = originalDepth === depth;

            return (
              <Button
                key={depth}
                variant='ghost'
                size='sm'
                className='justify-start p-1 px-2'
                onClick={() => {
                  handleDepthChange(depth);
                  setOpen(false);
                  onClose();
                }}
              >
                {t('document.plugins.outline.depthHeading', { level: depth.toString() })}
                {isSelected && <CheckIcon className='ml-auto h-5 w-5 text-icon-info-thick' />}
              </Button>
            );
          })}
        </div>
      </Popover>
    </>
  );
}

export function OutlineCollapseControl({ node, onToggle }: { node: OutlineNode; onToggle: () => void }) {
  const { t } = useTranslation();
  const { collapsedMap, toggleCollapsed } = useEditorLocalState();

  const isCollapsed = collapsedMap?.[node.blockId] ?? false;

  const onClick = useCallback(() => {
    if (toggleCollapsed) {
      toggleCollapsed(node.blockId);
    }

    onToggle();
  }, [node.blockId, onToggle, toggleCollapsed]);

  return (
    <Button size='sm' variant='ghost' className='justify-start px-1' onClick={onClick}>
      {isCollapsed ? <ExpandIcon className='h-5 w-5' /> : <CollapseIcon className='h-5 w-5' />}
      {isCollapsed ? t('document.plugins.outline.expandAll') : t('document.plugins.outline.collapseAll')}
    </Button>
  );
}
