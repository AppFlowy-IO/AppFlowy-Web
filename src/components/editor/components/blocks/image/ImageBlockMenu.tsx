import { PopoverOrigin, Popper } from '@mui/material';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactEditor, useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { Popover } from '@/components/_shared/popover';
import { useAIEnabled } from '@/components/app/app.hooks';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { ImageBlockNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { copyTextToClipboard } from '@/utils/copy';
import { resolveFileUrl, isLocalFilePath } from '@/utils/file-storage-url';

import { imageAction, ImageAction } from './image-actions';
import { imageName } from './image-data';
import { hasUnfinishedImageUpload } from './image-duplication';
import { copyImage, downloadImage } from './image-transfer';
import { writableImage } from './image-upload';
import { useImageUploading } from './image-upload-state';
import { ImageAlignmentOptions } from './ImageAlignmentOptions';
import { ImageMenuRow, imageMenuPaper } from './ImageIcons';
import { turnImageIntoPage } from './turn-image-into-page';

export function ImageBlockMenu({
  node,
  anchorEl,
  onClose,
  anchorOrigin,
  transformOrigin,
}: {
  node: ImageBlockNode;
  anchorEl: HTMLElement;
  onClose: () => void;
  anchorOrigin?: PopoverOrigin;
  transformOrigin?: PopoverOrigin;
}) {
  const editor = useSlateStatic() as YjsEditor;
  const context = useEditorContext();
  const readOnly = useReadOnly() || editor.isElementReadOnly(node);
  const aiEnabled = useAIEnabled();
  const { openPopover } = usePopoverContext();
  const { t } = useTranslation();
  const uploading = useImageUploading(editor, node.blockId);
  const menu = useRef<HTMLDivElement>(null);
  const [sub, setSub] = useState<{ type: 'align' | 'turn'; anchor: HTMLElement; keyboard: boolean }>();
  const subAnchor = useMemo(
    () =>
      sub && {
        contextElement: sub.anchor,
        getBoundingClientRect: () => {
          const row = sub.anchor.getBoundingClientRect();
          const rect = menu.current?.getBoundingClientRect() || row;

          return new DOMRect(rect.x, row.y, rect.width, row.height);
        },
      },
    [sub]
  );
  const focus = useCallback(
    (el: HTMLDivElement | null) => {
      if (sub?.keyboard) el?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
    },
    [sub]
  );
  const run = (operation: (live: ImageBlockNode) => void) => {
    const live = writableImage(editor, node.blockId);

    if (live && !readOnly) operation(live);
    onClose();
  };

  const action = (value: ImageAction) => {
    imageAction(editor, node.blockId, value);
    onClose();
  };

  const source = resolveFileUrl(node.data.url || '', context.workspaceId, context.viewId);
  const transfer = (operation: () => Promise<void>) => {
    void operation().catch(() => notify.error(t('web.imageBlock.actionFailed')));
    onClose();
  };

  const copyLink = (url: string) =>
    transfer(() => copyTextToClipboard(url).then(() => notify.success(t('chat.success.copied'))));

  const available = !!source && !isLocalFilePath(node.data.url);
  const submenu = (type: 'align' | 'turn') => ({
    submenu: true,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': sub?.type === type,
    onClick: (event: React.MouseEvent<HTMLButtonElement>) =>
      setSub({ type, anchor: event.currentTarget, keyboard: event.detail === 0 }),
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setSub({ type, anchor: event.currentTarget, keyboard: true });
      }
    },
  });
  const divider = <div className='-mx-2 my-2 border-t border-border-primary' />;

  return (
    <Popover
      open
      anchorEl={anchorEl}
      onClose={onClose}
      disableEnforceFocus
      anchorOrigin={anchorOrigin}
      transformOrigin={transformOrigin}
      PaperProps={imageMenuPaper}
      onKeyDownCapture={(event) => {
        if (sub && ['Escape', 'ArrowLeft'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          sub.anchor.focus();
          setSub(undefined);
        }
      }}
    >
      <div ref={menu} className='flex w-[240px] flex-col p-2' data-testid='image-menu'>
        <div className='px-2 py-1.5 text-xs font-medium leading-[18px] tracking-[0.1px] text-text-tertiary'>
          {t('editor.image')}
        </div>
        {!readOnly && (
          <>
            <ImageMenuRow icon='delete' danger onClick={() => run(() => CustomEditor.deleteBlock(editor, node.blockId))}>
              {t('button.delete')}
            </ImageMenuRow>
            <ImageMenuRow
              icon='duplicate'
              disabled={uploading || hasUnfinishedImageUpload(editor, node)}
              onClick={() =>
                run((live) => {
                  if (!hasUnfinishedImageUpload(editor, live))
                    CustomEditor.duplicateBlock(editor, live.blockId, live.blockId);
                })
              }
            >
              {t('button.duplicate')}
            </ImageMenuRow>
          </>
        )}
        <ImageMenuRow
          icon='link'
          onClick={() => {
            const url = new URL(location.href);

            url.searchParams.set('blockId', node.blockId);
            copyLink(url.href);
          }}
        >
          {t('document.plugins.optionAction.copyLinkToBlock')}
        </ImageMenuRow>
        {node.data.url && (node.data.source === 'network' || node.data.source === 'unsplash') && (
          <ImageMenuRow icon='original' onClick={() => copyLink(node.data.url!)}>
            {t('document.plugins.pdf.copyLinkToOriginal')}
          </ImageMenuRow>
        )}
        {!readOnly && context.addPage && (
          <ImageMenuRow icon='turn' {...submenu('turn')}>
            {t('document.plugins.optionAction.turnInto')}
          </ImageMenuRow>
        )}
        {node.data.url && (
          <>
            {divider}
            {!readOnly && (
              <ImageMenuRow
                icon='replace'
                onClick={() =>
                  run((live) => openPopover(live.blockId, BlockType.ImageBlock, ReactEditor.toDOMNode(editor, live)))
                }
              >
                {t('document.plugins.pdf.replace')}
              </ImageMenuRow>
            )}
            <ImageMenuRow
              icon='download'
              disabled={!available}
              onClick={() => transfer(() => downloadImage(source, imageName(node.data)))}
            >
              {t('button.download')}
            </ImageMenuRow>
            {!readOnly && (
              <ImageMenuRow icon='link' onClick={() => action('link')}>
                {t(node.data.link ? 'web.imageBlock.editLink' : 'web.imageBlock.embedLink')}
              </ImageMenuRow>
            )}
            <ImageMenuRow
              icon='copy'
              disabled={!available}
              onClick={() => transfer(() => copyImage(source).then(() => notify.success(t('chat.success.copied'))))}
            >
              {t('web.imageBlock.copyImage')}
            </ImageMenuRow>
            <ImageMenuRow icon='fullscreen' disabled={!available} onClick={() => action('fullscreen')}>
              {t('document.plugins.pdf.fullScreen')}
            </ImageMenuRow>
            {!readOnly && (
              <ImageMenuRow
                icon='caption'
                onClick={() => {
                  if (typeof node.data.caption !== 'string') return action('caption');
                  if (writableImage(editor, node.blockId))
                    CustomEditor.setBlockData(editor, node.blockId, { caption: undefined });
                  onClose();
                }}
              >
                {t(
                  typeof node.data.caption === 'string'
                    ? 'document.plugins.pdf.removeCaption'
                    : 'document.plugins.pdf.addCaption'
                )}
              </ImageMenuRow>
            )}
          </>
        )}
        {!readOnly && (
          <>
            {!node.data.url && divider}
            <ImageMenuRow icon='align' {...submenu('align')}>
              {t('document.plugins.optionAction.align')}
            </ImageMenuRow>
          </>
        )}
        {!readOnly && aiEnabled && (
          <>
            {divider}
            <ImageMenuRow icon='ai' onClick={() => action('ask')}>
              {t('document.plugins.pdf.askAI')}
            </ImageMenuRow>
          </>
        )}
      </div>
      <Popper
        open={!!sub}
        anchorEl={subAnchor}
        placement='right-start'
        modifiers={[
          { name: 'offset', options: { offset: [0, 4] } },
          { name: 'flip', options: { fallbackPlacements: ['left-start'], padding: 16 } },
          { name: 'preventOverflow', options: { padding: 16, altAxis: true } },
        ]}
        sx={{ zIndex: (theme) => theme.zIndex.modal + 1 }}
        className={imageMenuPaper.className}
      >
        <div ref={focus} className='max-h-[calc(100dvh-32px)] w-[240px] overflow-y-auto p-2' data-testid='image-submenu'>
          {sub?.type === 'align' ? (
            <ImageAlignmentOptions
              align={node.data.align}
              onChange={(align) => run(() => CustomEditor.setBlockData(editor, node.blockId, { align }))}
            />
          ) : (
            <>
              {context.addPage && (
                <ImageMenuRow
                  disabled={!!node.data.pending_upload_id || !!node.data.retry_local_url}
                  onClick={() => {
                    onClose();
                    void turnImageIntoPage(editor, context, node.blockId).catch(() =>
                      notify.error(t('web.imageBlock.actionFailed'))
                    );
                  }}
                >
                  {t('editor.page')}
                </ImageMenuRow>
              )}
            </>
          )}
        </div>
      </Popper>
    </Popover>
  );
}
