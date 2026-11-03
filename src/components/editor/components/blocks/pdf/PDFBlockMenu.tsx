import { PopoverOrigin, Popper } from '@mui/material';
import { useCallback, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactEditor, useReadOnly, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import { Popover } from '@/components/_shared/popover';
import { useAIEnabled } from '@/components/app/app.hooks';
import { usePopoverContext } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { PDFNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { createSubpage } from '@/components/editor/subpage/create-subpage';
import { copyTextToClipboard } from '@/utils/copy';
import { downloadFile } from '@/utils/download';
import { resolveFileUrl } from '@/utils/file-storage-url';

import { usePDFReady } from './pdf-block-state';
import { openPDFInBrowser } from './pdf-browser';
import { isLocalPDF, isNetworkPDF, pdfFileName } from './pdf-data';
import { PDFAIMenuItems, PDFAIMode, PDFAlignmentItems, pdfIcons, PDFMenuAIIcon, pdfMenuPaper, PDFMenuRow } from './PDFMenuItems';

export const PDF_ACTION_EVENT = 'appflowy:pdf-action';
export type PDFAction = 'fullscreen' | 'caption' | PDFAIMode;

export function PDFBlockMenu({
  node,
  anchorEl,
  onClose,
  anchorOrigin,
  transformOrigin,
}: {
  node: PDFNode;
  anchorEl: HTMLElement;
  onClose: () => void;
  anchorOrigin?: PopoverOrigin;
  transformOrigin?: PopoverOrigin;
}) {
  const editor = useSlateStatic() as YjsEditor;
  const readOnly = useReadOnly() || editor.isElementReadOnly(node);
  const context = useEditorContext();
  const aiEnabled = useAIEnabled();
  const ready = usePDFReady(editor, node.blockId);
  const { openPopover } = usePopoverContext();
  const { t } = useTranslation();
  const menuRef = useRef<HTMLDivElement>(null);
  const [submenu, setSubmenu] = useState<{ type: 'align' | 'turn' | 'ai'; anchor: HTMLElement; keyboard?: boolean }>();
  // Use the main menu's outside edge and the selected row's vertical position.
  const submenuAnchor = useMemo(
    () => submenu && ({
      contextElement: submenu.anchor,
      getBoundingClientRect: () => {
        const row = submenu.anchor.getBoundingClientRect();
        const menu = menuRef.current?.getBoundingClientRect() ?? row;

        return new DOMRect(menu.x, row.y, menu.width, row.height);
      },
    }),
    [submenu]
  );
  const focusSubmenu = useCallback((element: HTMLDivElement | null) => {
    if (submenu?.keyboard) element?.querySelector<HTMLButtonElement>('button:not(:disabled)')?.focus();
  }, [submenu]);
  const current = () => findSlateEntryByBlockId(editor, node.blockId)?.[0] as PDFNode | undefined;
  const run = (action: (node: PDFNode) => void) => {
    const live = current();

    if (live?.type === BlockType.PDFBlock && !readOnly && !editor.readOnly && !editor.isElementReadOnly(live))
      action(live);
    onClose();
  };

  const action = (value: PDFAction) => {
    const live = current();

    if (live)
      ReactEditor.toDOMNode(editor, live).dispatchEvent(
        new CustomEvent(PDF_ACTION_EVENT, { detail: value, bubbles: true })
      );
    onClose();
  };

  const source = resolveFileUrl(node.data.url || '', context.workspaceId, context.viewId);
  const divider = <div className='-mx-2 my-2 border-t border-border-primary' />;
  const submenuProps = (type: 'align' | 'turn' | 'ai') => ({
    submenu: true,
    'aria-haspopup': 'menu' as const,
    'aria-expanded': submenu?.type === type,
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => setSubmenu({ type, anchor: event.currentTarget, keyboard: event.detail === 0 }),
    onKeyDown: (event: React.KeyboardEvent<HTMLButtonElement>) => {
      if (event.key === 'ArrowRight') {
        event.preventDefault();
        setSubmenu({ type, anchor: event.currentTarget, keyboard: true });
      }
    },
  });

  return (
    <Popover
      open
      anchorEl={anchorEl}
      onClose={onClose}
      disableEnforceFocus
      onKeyDownCapture={(event) => {
        if (submenu && (event.key === 'Escape' || event.key === 'ArrowLeft')) {
          event.preventDefault();
          event.stopPropagation();
          submenu.anchor.focus();
          setSubmenu(undefined);
        }
      }}
      anchorOrigin={anchorOrigin}
      transformOrigin={transformOrigin}
      PaperProps={pdfMenuPaper}
    >
      <div ref={menuRef} className='flex w-[240px] flex-col p-2' data-testid='pdf-menu'>
        <div className='px-2 py-1.5 text-xs font-medium leading-[18px] tracking-[0.1px] text-text-secondary'>
          {t('document.plugins.pdf.name')}
        </div>
        {!readOnly && (
          <>
            <PDFMenuRow
              icon={pdfIcons.delete}
              danger
              onClick={() => run(() => CustomEditor.deleteBlock(editor, node.blockId))}
            >
              {t('button.delete')}
            </PDFMenuRow>
            <PDFMenuRow
              icon={pdfIcons.duplicate}
              onClick={() => run(() => CustomEditor.duplicateBlock(editor, node.blockId, node.blockId))}
            >
              {t('button.duplicate')}
            </PDFMenuRow>
            <PDFMenuRow
              icon={pdfIcons.link}
              onClick={() => {
                const url = new URL(window.location.href);

                url.searchParams.set('blockId', node.blockId);
                void copyTextToClipboard(url.href);
                onClose();
              }}
            >
              {t('document.plugins.optionAction.copyLinkToBlock')}
            </PDFMenuRow>
            {node.data.url && isNetworkPDF(node.data) && (
              <PDFMenuRow
                icon={pdfIcons.original}
                onClick={() => {
                  void copyTextToClipboard(node.data.url!);
                  onClose();
                }}
              >
                {t('document.plugins.pdf.copyLinkToOriginal')}
              </PDFMenuRow>
            )}
            <PDFMenuRow icon={pdfIcons.turn} {...submenuProps('turn')}>
              {t('document.plugins.optionAction.turnInto')}
            </PDFMenuRow>
          </>
        )}
        {node.data.url && (
          <>
            {divider}
            {!readOnly && (
              <PDFMenuRow
                icon={pdfIcons.replace}
                onClick={() =>
                  run((live) => openPopover(live.blockId, BlockType.PDFBlock, ReactEditor.toDOMNode(editor, live)))
                }
              >
                {t('document.plugins.pdf.replace')}
              </PDFMenuRow>
            )}
            <PDFMenuRow
              icon={pdfIcons.download}
              disabled={isLocalPDF(node.data)}
              onClick={() => {
                void downloadFile(source, pdfFileName(node.data));
                onClose();
              }}
            >
              {t('button.download')}
            </PDFMenuRow>
            <PDFMenuRow icon={pdfIcons.fullscreen} disabled={!ready} onClick={() => action('fullscreen')}>
              {t('document.plugins.pdf.fullScreen')}
            </PDFMenuRow>
            <PDFMenuRow
              icon={pdfIcons.open}
              disabled={isLocalPDF(node.data)}
              onClick={() => {
                openPDFInBrowser(source, pdfFileName(node.data));
                onClose();
              }}
            >
              {t('document.plugins.pdf.openInBrowser')}
            </PDFMenuRow>
            {!readOnly && (
              <>
                <PDFMenuRow icon={pdfIcons.caption} onClick={() => action('caption')}>
                  {t('document.plugins.pdf.addCaption')}
                </PDFMenuRow>
                <PDFMenuRow icon={pdfIcons.align} {...submenuProps('align')}>
                  {t('document.plugins.optionAction.align')}
                </PDFMenuRow>
              </>
            )}
          </>
        )}
        {!readOnly && aiEnabled && (
          <>
            {divider}
            <PDFMenuRow icon={<PDFMenuAIIcon />} disabled={!ready && !!node.data.url} {...submenuProps('ai')}>
              {t('document.plugins.pdf.askAI')}
            </PDFMenuRow>
          </>
        )}
      </div>
      <Popper
        open={!!submenu}
        anchorEl={submenuAnchor}
        placement='right-start'
        modifiers={[
          { name: 'offset', options: { offset: [0, 4] } },
          { name: 'flip', options: { fallbackPlacements: ['left-start'], padding: 16 } },
          { name: 'preventOverflow', options: { padding: 16, altAxis: true } },
        ]}
        sx={{ zIndex: (theme) => theme.zIndex.modal + 1 }}
        className={pdfMenuPaper.className}
      >
        <div ref={focusSubmenu} className='w-[240px] p-2' data-testid='pdf-submenu'>
          {submenu?.type === 'align' && (
            <PDFAlignmentItems
              onAlign={(align) => run(() => CustomEditor.setBlockData(editor, node.blockId, { align }))}
            />
          )}
          {submenu?.type === 'ai' && <PDFAIMenuItems canSummarize={ready} onAction={action} />}
          {submenu?.type === 'turn' && (
            <PDFMenuRow
              disabled={!context.addPage || !!node.data.pending_upload_id}
              onClick={() =>
                run((live) => {
                  const entry = findSlateEntryByBlockId(editor, live.blockId);

                  if (!entry) return;
                  editor.select(editor.start(entry[1]));
                  void createSubpage(editor, context).catch(() =>
                    notify.error(t('document.plugins.subPage.errors.failedCreatePage'))
                  );
                })
              }
            >
              {t('editor.page')}
            </PDFMenuRow>
          )}
        </div>
      </Popper>
    </Popover>
  );
}
