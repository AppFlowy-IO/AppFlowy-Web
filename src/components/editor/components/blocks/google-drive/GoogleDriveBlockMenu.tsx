import { PopoverOrigin, Popper } from '@mui/material';
import { useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactEditor, useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { BlockType } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { Popover } from '@/components/_shared/popover';
import { useAIEnabled } from '@/components/app/app.hooks';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { GoogleDriveBlockNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { copyTextToClipboard } from '@/utils/copy';
import { openUrl } from '@/utils/url';

import { dispatchDriveAction, DriveAction, writableDrive } from './drive-actions';
import { validDriveSource } from './drive-data';
import { DriveAlignItems, driveMenuPaper, DriveMenuRow } from './DriveMenuItems';
import { turnDriveIntoPage } from './turn-drive-into-page';

function moveMenuFocus(event: React.KeyboardEvent<HTMLDivElement>) {
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  event.preventDefault();
  event.stopPropagation();
  const rows = Array.from(event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)'));
  const index = rows.indexOf(document.activeElement as HTMLButtonElement);
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
      ? rows.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length;

  rows[next]?.focus();
}

export function GoogleDriveBlockMenu({
  node,
  anchorEl,
  onClose,
  anchorOrigin,
  transformOrigin,
}: {
  node: GoogleDriveBlockNode;
  anchorEl: HTMLElement;
  onClose: () => void;
  anchorOrigin?: PopoverOrigin;
  transformOrigin?: PopoverOrigin;
}) {
  const editor = useSlateStatic() as YjsEditor;
  const context = useEditorContext();
  const readOnly = useReadOnly() || editor.isElementReadOnly(node);
  const ai = useAIEnabled();
  const { t } = useTranslation();
  const { openPopover } = usePopoverContext();
  const menu = useRef<HTMLDivElement>(null);
  const [submenu, setSubmenu] = useState<{ type: 'turn' | 'align'; anchor: HTMLElement; keyboard?: boolean }>();
  const anchor = useMemo(
    () =>
      submenu && {
        contextElement: submenu.anchor,
        getBoundingClientRect: () => {
          const row = submenu.anchor.getBoundingClientRect();
          const panel = menu.current?.getBoundingClientRect() || row;

          return new DOMRect(panel.x, row.y, panel.width, row.height);
        },
      },
    [submenu]
  );
  const url = validDriveSource(node.data.url);
  const run = (action: (live: GoogleDriveBlockNode) => void) => {
    const live = writableDrive(editor, node.blockId);

    if (!readOnly && live) action(live);
    onClose();
  };

  const dispatch = (action: DriveAction) => {
    dispatchDriveAction(editor, node.blockId, action);
    onClose();
  };

  const copy = async (url: string) => {
    onClose();
    try {
      await copyTextToClipboard(url);
      notify.success(t('chat.success.copied'));
    } catch {
      notify.error(t('document.plugins.googleDrive.copyFailed'));
    }
  };

  const child = (type: 'turn' | 'align') => ({
    submenu: true,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': submenu?.type === type,
    onMouseEnter: (event: React.MouseEvent<HTMLButtonElement>) => setSubmenu({ type, anchor: event.currentTarget }),
    onClick: (event: React.MouseEvent<HTMLButtonElement>) =>
      setSubmenu({ type, anchor: event.currentTarget, keyboard: event.detail === 0 }),
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setSubmenu({ type, anchor: event.currentTarget, keyboard: true });
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
      PaperProps={driveMenuPaper}
      onKeyDownCapture={(event) => {
        if (submenu && ['Escape', 'ArrowLeft'].includes(event.key)) {
          event.preventDefault();
          event.stopPropagation();
          submenu.anchor.focus();
          setSubmenu(undefined);
        }
      }}
    >
      <div
        role='menu'
        ref={menu}
        data-testid='google-drive-menu'
        className='w-[240px] p-2'
        onMouseOver={(event) => {
          const row = (event.target as HTMLElement).closest('[role="menuitem"]');

          if (row && !row.hasAttribute('aria-haspopup')) setSubmenu(undefined);
        }}
        onKeyDown={moveMenuFocus}
      >
        <div className='px-2 py-1.5 text-xs font-medium leading-[18px] tracking-[0.1px] text-text-secondary'>
          {t('document.plugins.googleDrive.name')}
        </div>
        {!readOnly && (
          <>
            <DriveMenuRow icon='delete' danger onClick={() => run(() => CustomEditor.deleteBlock(editor, node.blockId))}>
              {t('button.delete')}
            </DriveMenuRow>
            <DriveMenuRow
              icon='duplicate'
              onClick={() => run(() => CustomEditor.duplicateBlock(editor, node.blockId, node.blockId))}
            >
              {t('button.duplicate')}
            </DriveMenuRow>
          </>
        )}
        <DriveMenuRow
          icon='link'
          onClick={() => {
            const link = new URL(location.href);

            link.searchParams.set('blockId', node.blockId);
            void copy(link.href);
          }}
        >
          {t('document.plugins.optionAction.copyLinkToBlock')}
        </DriveMenuRow>
        {url && (
          <DriveMenuRow icon='original' onClick={() => void copy(url)}>
            {t('button.copyLinkOriginal')}
          </DriveMenuRow>
        )}
        {!readOnly && (
          <DriveMenuRow icon='turn' {...child('turn')}>
            {t('document.plugins.optionAction.turnInto')}
          </DriveMenuRow>
        )}
        {!!node.data.url && (
          <>
            {divider}
            {!readOnly && (
              <DriveMenuRow
                icon='replace'
                onClick={() =>
                  run((live) =>
                    openPopover(live.blockId, BlockType.GoogleDriveBlock, ReactEditor.toDOMNode(editor, live))
                  )
                }
              >
                {t('document.plugins.googleDrive.replace')}
              </DriveMenuRow>
            )}
            <DriveMenuRow icon='reload' disabled={!url} onClick={() => dispatch('reload')}>
              {t('document.plugins.googleDrive.reload')}
            </DriveMenuRow>
            <DriveMenuRow icon='fullscreen' disabled={!url} onClick={() => dispatch('fullscreen')}>
              {t('document.plugins.pdf.fullScreen')}
            </DriveMenuRow>
            <DriveMenuRow
              icon='open'
              disabled={!url}
              onClick={() => {
                if (url) void openUrl(url, '_blank', 'noopener,noreferrer');
                onClose();
              }}
            >
              {t('document.plugins.pdf.openInBrowser')}
            </DriveMenuRow>
            {!readOnly && (
              <>
                <DriveMenuRow icon='caption' onClick={() => dispatch('caption')}>
                  {t('document.plugins.pdf.addCaption')}
                </DriveMenuRow>
                <DriveMenuRow icon='align' {...child('align')}>
                  {t('document.plugins.optionAction.align')}
                </DriveMenuRow>
              </>
            )}
          </>
        )}
        {!readOnly && ai && (
          <>
            {divider}
            <DriveMenuRow icon='ai' onClick={() => dispatch('ask')}>
              {t('document.plugins.pdf.askAI')}
            </DriveMenuRow>
          </>
        )}
      </div>
      <Popper
        open={!!submenu}
        anchorEl={anchor}
        placement='right-start'
        modifiers={[
          { name: 'offset', options: { offset: [0, 4] } },
          { name: 'flip', options: { fallbackPlacements: ['left-start'], padding: 16 } },
          { name: 'preventOverflow', options: { padding: 16, altAxis: true } },
        ]}
        sx={{ zIndex: 1400 }}
        className={driveMenuPaper.className}
      >
        <div
          role='menu'
          data-testid='google-drive-submenu'
          className='w-[200px] p-2'
          onKeyDown={moveMenuFocus}
          ref={(element) => {
            if (submenu?.keyboard) element?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
          }}
        >
          {submenu?.type === 'align' && (
            <DriveAlignItems
              align={node.data.align}
              onChange={(align) => run(() => CustomEditor.setBlockData(editor, node.blockId, { align }))}
            />
          )}
          {submenu?.type === 'turn' && (
            <DriveMenuRow
              disabled={!context.addPage}
              onClick={() =>
                run(() => {
                  void turnDriveIntoPage(editor, context, node.blockId).catch(() =>
                    notify.error(t('document.plugins.subPage.errors.failedCreatePage'))
                  );
                })
              }
            >
              {t('editor.page')}
            </DriveMenuRow>
          )}
        </div>
      </Popper>
    </Popover>
  );
}
