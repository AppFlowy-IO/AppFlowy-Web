import TextareaAutosize from '@mui/material/TextareaAutosize';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import errorIcon from '@/assets/icons/pdf/figma/0a1039c9c8bfe056ce63b7473034833d3c12d2bd.svg';
import lockIcon from '@/assets/icons/pdf/figma/4e1e145f5d12f8132d712f61a7365758e54fd749.svg';
import { notify } from '@/components/_shared/notify';
import { useAIEnabled } from '@/components/app/app.hooks';
import { PDFNode } from '@/components/editor/editor.type';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { downloadFile } from '@/utils/download';

import { registerPDFReady } from './pdf-block-state';
import { pdfFileName, pdfSize } from './pdf-data';
import { PDF_ACTION_EVENT, PDFBlockMenu } from './PDFBlockMenu';
import { PDFAIMode } from './PDFMenuItems';
import { PDFPages } from './PDFPages';
import { PDFToolbar } from './PDFToolbar';
import { usePDFDocument } from './usePDFDocument';

const PDFAssistant = lazy(() => import('./PDFAssistant'));

export default function PDFViewer({
  node,
  source,
  readOnly,
  onChange,
}: {
  node: PDFNode;
  source: string;
  readOnly: boolean;
  onChange: (data: Partial<PDFNode['data']>) => void;
}) {
  const editor = useSlateStatic() as YjsEditor;
  const aiEnabled = useAIEnabled();
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { t } = useTranslation();
  const root = useRef<HTMLDivElement>(null);
  const caption = useRef<HTMLTextAreaElement>(null);
  const [focusCaption, setFocusCaption] = useState(false);
  const showCaption = typeof node.data.caption === 'string';
  // Keep the loaded document while this block is mounted. Screenshot overlays
  // and tab visibility changes must not destroy its worker or reset the preview.
  const { state, unlock, retry } = usePDFDocument(source);

  useEffect(() => {
    if (state.status === 'ready') return registerPDFReady(editor, node.blockId);
  }, [editor, node.blockId, state.status]);
  const [password, setPassword] = useState('');
  const submittedPassword = useRef('');
  const [fullscreen, setFullscreen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const [menu, setMenu] = useState<HTMLElement | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [assistant, setAssistant] = useState<{ text: string; mode: PDFAIMode; id: number }>();
  const size = pdfSize(node.data);
  const [draftSize, setDraftSize] = useState<typeof size>();
  const displayedSize = draftSize || size;
  const name = pdfFileName(node.data);

  useEffect(() => {
    if (focusCaption && showCaption) {
      if (!readOnly) caption.current?.focus();
      setFocusCaption(false);
    }
  }, [focusCaption, showCaption, readOnly]);

  useEffect(() => {
    if (state.status === 'ready') {
      setPassword('');
      submittedPassword.current = '';
    }
  }, [state.status]);

  const startAI = useCallback(
    async (mode: PDFAIMode) => {
      if (state.status !== 'ready' || !aiEnabled || readOnly || extracting) return;
      const document = state.document;

      setExtracting(true);
      try {
        const pages: string[] = [];

        for (let number = 1; number <= document.numPages; number++) {
          if (!mounted.current) return;
          const page = await document.getPage(number);
          const content = await page.getTextContent();

          pages.push(content.items.map((item) => ('str' in item ? item.str : '')).join(' '));
        }

        const live = findSlateEntryByBlockId(editor, node.blockId);

        if (
          !mounted.current ||
          !live ||
          editor.readOnly ||
          editor.isElementReadOnly(live[0]) ||
          (live[0] as PDFNode).data.url !== node.data.url
        )
          return;
        if (!pages.join('').trim()) {
          notify.error(t('document.plugins.pdf.noText'));
          return;
        }

        ReactEditor.blur(editor);
        setAssistant({ text: pages.join('\n\n'), mode, id: Date.now() });
      } catch {
        if (mounted.current) notify.error(t('document.plugins.pdf.loadError'));
      } finally {
        if (mounted.current) setExtracting(false);
      }
    },
    [state, aiEnabled, readOnly, extracting, editor, node.blockId, node.data.url, t]
  );

  useEffect(() => {
    const live = findSlateEntryByBlockId(editor, node.blockId)?.[0];
    const element = live && ReactEditor.toDOMNode(editor, live);
    const listener = (event: Event) => {
      const action = (event as CustomEvent).detail;

      if (action === 'fullscreen' && state.status === 'ready') setFullscreen(true);
      else if (action === 'summary' || action === 'ask') void startAI(action);
      else if (action === 'caption') {
        const current = findSlateEntryByBlockId(editor, node.blockId)?.[0] as PDFNode | undefined;

        if (!current || readOnly || editor.readOnly || editor.isElementReadOnly(current)) return;
        if (typeof current.data.caption !== 'string') onChange({ caption: '' });
        setFocusCaption(true);
      }
    };

    element?.addEventListener(PDF_ACTION_EVENT, listener);
    return () => element?.removeEventListener(PDF_ACTION_EVENT, listener);
  }, [editor, node.blockId, state.status, startAI, readOnly, onChange]);

  const startResize = (event: React.PointerEvent<HTMLButtonElement>, direction: 'left' | 'right' | 'top' | 'bottom') => {
    event.preventDefault();
    event.stopPropagation();
    const container = root.current?.parentElement;

    if (!container) return;
    const width = container.clientWidth;

    if (width <= 0) return;
    const x = event.clientX;
    const y = event.clientY;
    const handle = event.currentTarget;
    let next = size;

    handle.setPointerCapture(event.pointerId);
    handle.onpointermove = (move) => {
      next =
        direction === 'left' || direction === 'right'
          ? {
              ...size,
              widthFactor: Math.min(
                1,
                Math.max(
                  Math.min(120 / width, 1),
                  size.widthFactor +
                    ((move.clientX - x) / width) *
                      (node.data.align === 'center' || !node.data.align ? 2 : 1) *
                      (direction === 'left' ? -1 : 1)
                )
              ),
            }
          : {
              ...size,
              heightFactor: Math.min(
                4,
                Math.max(0.3, size.heightFactor + ((move.clientY - y) / 400) * (direction === 'top' ? -1 : 1))
              ),
            };
      setDraftSize(next);
    };

    const finish = (commit: boolean) => {
      handle.onpointermove = handle.onpointerup = handle.onpointercancel = handle.onlostpointercapture = null;
      setDraftSize(undefined);
      if (commit) onChange(next);
    };

    handle.onpointerup = () => finish(true);
    handle.onpointercancel = () => finish(false);
    handle.onlostpointercapture = () => finish(false);
  };

  return (
    <div
      ref={root}
      className='pdf-viewer group/pdf relative min-w-0'
      data-pdf-ready={state.status === 'ready'}
      style={{
        width: `${displayedSize.widthFactor * 100}%`,
        minWidth: 'min(120px, 100%)',
        marginLeft: node.data.align === 'left' ? 0 : 'auto',
        marginRight: node.data.align === 'right' ? 0 : 'auto',
      }}
    >
      <div
        className='pdf-selection-surface relative overflow-hidden rounded-xl border border-border-primary bg-fill-content-visible'
        style={{ height: state.status === 'password' ? 400 : displayedSize.heightFactor * 400 }}
      >
        {state.status === 'loading' && (
          <div role='status' className='flex h-full items-center justify-center gap-2 text-text-secondary'>
            <span className='h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent' />
            {t('document.plugins.pdf.loading')}
          </div>
        )}
        {state.status === 'error' && (
          <div role='alert' className='flex h-full flex-col items-center justify-center gap-5 p-8 text-text-secondary'>
            <div className='flex flex-col items-center'>
              <img src={errorIcon} alt='' />
              <p className='whitespace-pre-line py-1 text-center text-sm leading-5'>
                {t('document.plugins.pdf.previewError')}
              </p>
            </div>
            <Button className='h-8 rounded-md px-3 py-1.5 text-sm font-medium' onClick={retry}>
              {t('document.plugins.pdf.tryAgain')}
            </Button>
          </div>
        )}
        {state.status === 'password' && (
          <form
            className='pdf-password-form flex h-full flex-col items-center justify-center p-8'
            onSubmit={(event) => {
              event.preventDefault();
              if (!password.trim() || (state.incorrect && password === submittedPassword.current)) return;
              submittedPassword.current = password;
              unlock(password);
            }}
          >
            <img src={lockIcon} alt='' />
            <p className='mb-3 whitespace-pre-line py-1 text-center text-sm leading-5 text-text-secondary'>
              {t('document.plugins.pdf.protectedFile')}
            </p>
            <Input
              type='password'
              autoComplete='off'
              aria-label={t('document.plugins.pdf.password')}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              className={`h-8 w-[280px] max-w-full rounded-lg px-2 py-1.5 ${
                state.incorrect ? 'border-border-error-thick' : 'border-border-primary-hover'
              }`}
              aria-invalid={state.incorrect}
            />
            {state.incorrect && (
              <p role='alert' className='mt-1 text-xs leading-[18px] tracking-[0.1px] text-text-error'>
                {t('document.plugins.pdf.incorrectPassword')}
              </p>
            )}
            {(password.length > 0 || state.incorrect) && (
              <Button
                className='mt-6 h-8 rounded-md px-3 py-1.5 text-sm font-medium'
                type='submit'
                disabled={!password.trim() || (state.incorrect && password === submittedPassword.current)}
              >
                {t('document.plugins.pdf.unlock')}
              </Button>
            )}
          </form>
        )}
        {state.status === 'ready' && !fullscreen && <PDFPages document={state.document} />}
        <PDFToolbar
          ready={state.status === 'ready'}
          readOnly={readOnly}
          aiEnabled={aiEnabled}
          busy={extracting}
          onAI={(mode) => void startAI(mode)}
          menuOpen={!!menu}
          onFullscreen={() => setFullscreen(true)}
          onDownload={() => void downloadFile(source, name)}
          onMore={setMenu}
          onAlign={(align) => onChange({ align })}
        />
        {!readOnly &&
          state.status === 'ready' &&
          (['left', 'right', 'top', 'bottom'] as const).map((direction) => {
            const horizontal = direction === 'left' || direction === 'right';
            const length = displayedSize.heightFactor <= 0.3 ? 40 : 60;

            return (
              <button
                key={direction}
                aria-label={t(
                  (
                    {
                      left: 'document.plugins.pdf.resizeLeft',
                      right: 'document.plugins.pdf.resizeRight',
                      top: 'document.plugins.pdf.resizeTop',
                      bottom: 'document.plugins.pdf.resizeBottom',
                    } as const
                  )[direction]
                )}
                className={`pdf-resize-${direction} absolute z-10 rounded-full border border-white/80 bg-black/40 opacity-0 backdrop-blur-[2px] focus:opacity-100 group-hover/pdf:opacity-100 ${
                  horizontal
                    ? 'top-1/2 w-[6px] -translate-y-1/2 cursor-ew-resize'
                    : 'left-1/2 h-[6px] -translate-x-1/2 cursor-ns-resize'
                }`}
                style={{ touchAction: 'none', [direction]: 1, ...(horizontal ? { height: length } : { width: length }) }}
                onPointerDown={(event) => startResize(event, direction)}
                onKeyDown={(event) => {
                  const decrease = horizontal ? 'ArrowLeft' : 'ArrowUp';
                  const increase = horizontal ? 'ArrowRight' : 'ArrowDown';

                  if (event.key !== decrease && event.key !== increase) return;
                  event.preventDefault();
                  const delta =
                    (event.key === increase ? 1 : -1) * (direction === 'left' || direction === 'top' ? -1 : 1);

                  onChange(
                    horizontal
                      ? {
                          widthFactor: Math.max(
                            Math.min(120 / (root.current?.parentElement?.clientWidth || 120), 1),
                            Math.min(1, size.widthFactor + delta * 0.05)
                          ),
                        }
                      : { heightFactor: Math.max(0.3, Math.min(4, size.heightFactor + delta * 0.1)) }
                  );
                }}
              />
            );
          })}
      </div>
      {showCaption && (
        <TextareaAutosize
          ref={caption}
          contentEditable={false}
          minRows={1}
          aria-label={t('document.plugins.pdf.caption')}
          placeholder={t('document.plugins.pdf.captionPlaceholder')}
          className='pdf-caption'
          readOnly={readOnly}
          value={node.data.caption ?? ''}
          onChange={(event) => onChange({ caption: event.target.value })}
          onKeyDown={(event) => {
            event.stopPropagation();
            const current = findSlateEntryByBlockId(editor, node.blockId)?.[0];

            if (event.nativeEvent.isComposing || readOnly || editor.readOnly || !current || editor.isElementReadOnly(current))
              return;
            if (event.key === 'Backspace' && !event.currentTarget.value) {
              event.preventDefault();
              // A PDF has no editable text to join into. Only dismiss an empty caption.
              editor.flushLocalChanges();
              if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
              onChange({ caption: undefined });
              editor.flushLocalChanges();
              if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
              editor.select(ReactEditor.findPath(editor, current));
              ReactEditor.focus(editor);
            } else if (event.key === 'Escape') {
              event.preventDefault();
              event.currentTarget.blur();
            }
          }}
          onClick={(event) => event.stopPropagation()}
        />
      )}
      {assistant && !readOnly && aiEnabled && (
        <Suspense fallback={null}>
          <PDFAssistant
            key={assistant.id}
            node={node}
            text={assistant.text}
            mode={assistant.mode}
            onClose={() => setAssistant(undefined)}
          />
        </Suspense>
      )}
      {menu && <PDFBlockMenu node={node} anchorEl={menu} onClose={() => setMenu(null)} />}
      <Dialog open={fullscreen && state.status === 'ready'} onOpenChange={setFullscreen}>
        <DialogContent
          aria-describedby={undefined}
          className='!h-[95vh] !max-h-[95vh] !w-[95vw] !max-w-[95vw] !border-0 !bg-transparent !p-0'
          showCloseButton={false}
        >
          <DialogTitle className='sr-only'>{name}</DialogTitle>
          {state.status === 'ready' && <PDFPages document={state.document} zoom={zoom} />}
          <div className='absolute bottom-4 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-lg bg-black/80 p-2 text-white'>
            <button
              className='h-7 w-7'
              aria-label={t('gallery.zoomOut')}
              disabled={zoom <= 0.25}
              onClick={() => setZoom(Math.max(0.25, zoom - 0.25))}
            >
              −
            </button>
            <label>
              <span className='sr-only'>{t('document.plugins.pdf.zoom')}</span>
              <select
                className='bg-transparent text-sm'
                value={zoom}
                onChange={(event) => setZoom(Number(event.target.value))}
              >
                {Array.from({ length: 16 }, (_, i) => (i + 1) / 4).map((value) => (
                  <option className='bg-black' key={value} value={value}>
                    {value * 100}%
                  </option>
                ))}
              </select>
            </label>
            <button
              className='h-7 w-7'
              aria-label={t('gallery.zoomIn')}
              disabled={zoom >= 4}
              onClick={() => setZoom(Math.min(4, zoom + 0.25))}
            >
              +
            </button>
            <button className='h-7 w-7' aria-label={t('button.close')} onClick={() => setFullscreen(false)}>
              ×
            </button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
