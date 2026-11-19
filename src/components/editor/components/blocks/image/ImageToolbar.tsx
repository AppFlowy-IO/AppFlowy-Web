import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { Popover } from '@/components/_shared/popover';
import { useAIEnabled } from '@/components/app/app.hooks';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { ImageBlockNode } from '@/components/editor/editor.type';
import { useEditorLocalState } from '@/components/editor/EditorContext';
import { Button } from '@/components/ui/button';

import { imageAction } from './image-actions';
import { copyImage } from './image-transfer';
import { writableImage } from './image-upload';
import { ImageAlignmentOptions } from './ImageAlignmentOptions';
import { ImageBlockMenu } from './ImageBlockMenu';
import { ImageIcon, ImageIconName, imageMenuPaper } from './ImageIcons';

export default function ImageToolbar({ node }: { node: ImageBlockNode }) {
  const editor = useSlateStatic() as YjsEditor;
  const readOnly = useReadOnly() || editor.isElementReadOnly(node);
  const ai = useAIEnabled();
  const { setSelectedBlockIds } = useEditorLocalState();
  const { openPopover } = usePopoverContext();
  const { t } = useTranslation();
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [align, setAlign] = useState<HTMLElement | null>(null);
  const actions: { icon: ImageIconName; label: string; visible: boolean; action: (el: HTMLElement) => void }[] = [
    {
      icon: 'ai',
      label: t('document.plugins.pdf.askAI'),
      visible: !readOnly && ai,
      action: () => imageAction(editor, node.blockId, 'ask'),
    },
    {
      icon: 'replace',
      label: t('document.plugins.pdf.replace'),
      visible: !readOnly,
      action: () => openPopover(node.blockId, BlockType.ImageBlock),
    },
    {
      icon: 'fullscreen',
      label: t('document.plugins.pdf.fullScreen'),
      visible: true,
      action: () => imageAction(editor, node.blockId, 'fullscreen'),
    },
    {
      icon: 'copy',
      label: t('web.imageBlock.copyImage'),
      visible: true,
      action: () => {
        void copyImage(node.data.url || '')
          .then(() => notify.success(t('chat.success.copied')))
          .catch(() => notify.error(t('web.imageBlock.actionFailed')));
      },
    },
    { icon: 'align', label: t('document.plugins.optionAction.align'), visible: !readOnly, action: setAlign },
    {
      icon: 'more',
      label: t('web.imageBlock.options'),
      visible: true,
      action: (anchor) => {
        setSelectedBlockIds?.([node.blockId]);
        setMenu(anchor);
      },
    },
  ];

  return (
    <>
      <div
        className={`image-toolbar ${menu || align ? 'image-toolbar-open' : ''}`}
        aria-label={t('web.imageBlock.controls')}
      >
        {actions
          .filter((action) => action.visible)
          .map((action) => (
            <Button
              key={action.icon}
              variant='ghost'
              size='icon'
              className={`!h-7 !w-7 !rounded !p-1 !text-white hover:!bg-white/15 ${
                action.icon !== 'more' ? 'image-toolbar-expanded' : ''
              }`}
              title={action.label}
              aria-label={action.label}
              onClick={(event) => {
                event.stopPropagation();
                action.action(event.currentTarget);
              }}
            >
              <ImageIcon name={action.icon} />
            </Button>
          ))}
      </div>
      {menu && (
        <ImageBlockMenu
          node={node}
          anchorEl={menu}
          onClose={() => {
            setMenu(null);
            setSelectedBlockIds?.([]);
          }}
        />
      )}
      <Popover open={!!align} anchorEl={align} onClose={() => setAlign(null)} PaperProps={imageMenuPaper}>
        <div className='w-[240px] p-2' data-testid='image-align-menu'>
          <ImageAlignmentOptions
            align={node.data.align}
            onChange={(value) => {
              if (writableImage(editor, node.blockId)) CustomEditor.setBlockData(editor, node.blockId, { align: value });
              setAlign(null);
            }}
          />
        </div>
      </Popover>
    </>
  );
}
