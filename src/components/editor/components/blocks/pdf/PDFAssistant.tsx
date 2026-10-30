import { EditorData, EditorProvider } from '@appflowyinc/editor';
import TextareaAutosize from '@mui/material/TextareaAutosize';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { ReactEditor, useSlateStatic } from 'slate-react';

import { YjsEditor } from '@/application/slate-yjs';
import { YHistoryEditor } from '@/application/slate-yjs/plugins/withHistory';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { ReactComponent as EarthIcon } from '@/assets/icons/earth.svg';
import { ReactComponent as AIIcon } from '@/assets/icons/math-equation/ai-group.svg';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/math-equation/arrow-down.svg';
import { ReactComponent as DismissIcon } from '@/assets/icons/math-equation/dismiss.svg';
import { ReactComponent as InsertIcon } from '@/assets/icons/math-equation/insert.svg';
import { ReactComponent as RetryIcon } from '@/assets/icons/math-equation/retry.svg';
import { ReactComponent as SendDisabledIcon } from '@/assets/icons/math-equation/send-disabled.svg';
import { ReactComponent as SendIcon } from '@/assets/icons/math-equation/send.svg';
import { insertDataAfterBlock } from '@/components/ai-chat/utils';
import { RenderEditor } from '@/components/chat/components/ai-writer/render-editor';
import { ModelSelector } from '@/components/chat/components/chat-input/model-selector';
import { ModelSelectorContext } from '@/components/chat/contexts/model-selector-context';
import { WriterRequest } from '@/components/chat/request/writer-request';
import { AIAssistantType, CompletionResult, CompletionRole } from '@/components/chat/types';
import { MathEquationAILoading } from '@/components/editor/components/blocks/math-equation/MathEquationAILoading';
import { PDFNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

import { PDFAIMode } from './PDFMenuItems';
import './pdf.scss';

/** Mounted only after an explicit PDF AI action; uses the same request/renderer as the editor writer. */
export default function PDFAssistant({
  node,
  text,
  mode,
  onClose,
}: {
  node: PDFNode;
  text: string;
  mode: PDFAIMode;
  onClose: () => void;
}) {
  const editor = useSlateStatic() as YjsEditor;
  const { workspaceId, viewId, requestInstance } = useEditorContext();
  const { t } = useTranslation();
  const request = useMemo(
    () => new WriterRequest(workspaceId, viewId, requestInstance || undefined),
    [workspaceId, viewId, requestInstance]
  );
  const [content, setContent] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [input, setInput] = useState('');
  const [title, setTitle] = useState(mode);
  const [complete, setComplete] = useState(false);
  const [model, setModel] = useState('Auto');
  const [webSearchEnabled, setWebSearchEnabled] = useState(true);
  const modelRef = useRef(model);
  const webSearchRef = useRef(webSearchEnabled);

  modelRef.current = model;
  webSearchRef.current = webSearchEnabled;
  const modelContext = useMemo(
    () => ({ selectedModelName: model, setSelectedModelName: setModel, requestInstance: request }),
    [model, request]
  );
  const data = useRef<EditorData>();
  const controller = useRef<AbortController>();
  const history = useRef<CompletionResult[]>([]);
  const last = useRef<{ prompt: string; history: CompletionResult[] }>();
  const originalUrl = useRef(node.data.url);
  const source = useRef(text);
  const summaryPrompt = `${t('document.plugins.pdf.summaryPrompt')}\n\n${source.current}`;

  const generate = useCallback(
    async (prompt: string, previous: CompletionResult[]) => {
      controller.current?.abort();
      const active = new AbortController();

      controller.current = active;
      last.current = { prompt, history: previous };
      data.current = undefined;
      setBusy(true);
      setComplete(false);
      setError('');
      setContent('');
      try {
        let result = '';
        const { streamPromise } = await request.fetchAIAssistant(
          {
            inputText: prompt,
            assistantType: AIAssistantType.AskAIAnything,
            ragIds: [],
            completionHistory: previous,
            modelName: modelRef.current,
            webSearchEnabled: webSearchRef.current,
            signal: active.signal,
          },
          (answer, comment) => {
            if (active.signal.aborted) return;
            result = [answer, comment].filter(Boolean).join('\n\n');
            setContent(result);
          }
        );

        await streamPromise;
        if (active.signal.aborted) return;
        history.current = [
          ...previous,
          { role: CompletionRole.Human, content: prompt },
          { role: CompletionRole.AI, content: result },
        ];
        setComplete(true);
      } catch (error) {
        if (!active.signal.aborted) setError(error instanceof Error ? error.message : t('document.plugins.pdf.aiError'));
      } finally {
        if (!active.signal.aborted) setBusy(false);
      }
    },
    [request, t]
  );

  // Keep requests scoped to this assistant. Replacing/deleting the PDF aborts the stream.
  useEffect(() => {
    if (mode === 'summary') void generate(summaryPrompt, []);
    return () => controller.current?.abort();
    // The initial action is immutable for this mounted assistant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const insertBelow = () => {
    const live = findSlateEntryByBlockId(editor, node.blockId)?.[0] as PDFNode | undefined;

    if (
      !complete ||
      !data.current?.length ||
      live?.type !== BlockType.PDFBlock ||
      live.data.url !== originalUrl.current ||
      editor.readOnly ||
      editor.isElementReadOnly(live)
    )
      return;
    editor.flushLocalChanges();
    if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
    const blockId = insertDataAfterBlock(editor.sharedRoot, data.current, node.blockId);

    if (YHistoryEditor.isYHistoryEditor(editor)) editor.undoManager.stopCapturing();
    onClose();
    const entry = findSlateEntryByBlockId(editor, blockId);

    if (entry) {
      ReactEditor.focus(editor);
      editor.select(editor.end(entry[1]));
    }
  };

  const captureData = useCallback((value: EditorData) => {
    data.current = value;
  }, []);

  return (
    <section
      className='mt-1 overflow-hidden rounded-xl border border-border-primary bg-surface-layer-02 text-sm shadow-menu'
      data-testid='pdf-assistant'
      aria-label={t(title === 'summary' ? 'document.plugins.pdf.summarizePDF' : 'document.plugins.pdf.askAI')}
      contentEditable={false}
      onClick={(event) => event.stopPropagation()}
    >
      {(content || error || complete || (last.current && !busy)) && (
        <div className='flex flex-col gap-1 border-b border-border-primary bg-surface-container-layer-01 px-3 pb-4 pt-3'>
          <div className='text-xs font-medium leading-[18px] tracking-[0.1px] text-text-secondary'>
            {t(title === 'summary' ? 'document.plugins.pdf.summarizePDF' : 'document.plugins.pdf.askAI')}
          </div>
          {content && (
            <div className='pdf-summary max-h-[440px] overflow-y-auto text-sm leading-5' aria-busy={busy}>
              <EditorProvider>
                <RenderEditor content={content} onDataChange={captureData} />
              </EditorProvider>
            </div>
          )}
          {error && <p role='alert' className='text-text-error'>{error}</p>}
          {!busy && (
            <div className='flex flex-wrap gap-1'>
              <Button
                variant='ghost'
                className='h-7 px-2'
                disabled={!complete || !content || !!error}
                onClick={insertBelow}
              >
                <InsertIcon width={20} height={20} />
                {t('button.insertBelow')}
              </Button>
              <Button
                variant='ghost'
                className='h-7 px-2'
                disabled={!last.current}
                onClick={() => last.current && void generate(last.current.prompt, last.current.history)}
              >
                <RetryIcon width={20} height={20} />
                {t('button.tryAgain')}
              </Button>
              <Button variant='ghost' className='h-7 px-2' onClick={onClose}>
                <DismissIcon width={20} height={20} />
                {t('button.close')}
              </Button>
            </div>
          )}
        </div>
      )}
      {busy ? (
        <MathEquationAILoading onStop={() => {
          controller.current?.abort();
          setBusy(false);
        }} />
      ) : (
        <form
          className='flex flex-col pt-1'
          onSubmit={(event) => {
            event.preventDefault();
            if (!input.trim()) return;
            const prompt = history.current.length ? input.trim() : `${input.trim()}\n\n${source.current}`;

            setTitle('ask');
            setInput('');
            void generate(prompt, history.current);
          }}
        >
          <TextareaAutosize
            autoFocus
            minRows={1}
            maxRows={12}
            aria-label={t('document.plugins.pdf.askAI')}
            placeholder={t('chat.input.placeholder')}
            className='w-full resize-none bg-transparent px-[14px] py-2 text-sm leading-5 outline-none placeholder:text-text-placeholder'
            value={input}
            onChange={(event) => setInput(event.target.value)}
            onKeyDown={(event) => {
              event.stopPropagation();
              if (event.nativeEvent.isComposing) return;
              if (event.key === 'Escape') onClose();
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                event.currentTarget.form?.requestSubmit();
              }
            }}
          />
          <div className='mx-2 mb-1 flex h-8 items-center justify-between'>
            <div className='flex items-center gap-1'>
              <ModelSelectorContext.Provider value={modelContext}>
                <ModelSelector
                  className='gap-0 p-1'
                  triggerContent={
                    <>
                      <span className='relative h-5 w-5'>
                        <span className='absolute left-[3px] top-0.5'>
                          <AIIcon width={15.0013} height={16} />
                        </span>
                      </span>
                      <ArrowDownIcon width={12} height={20} />
                    </>
                  }
                />
              </ModelSelectorContext.Provider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type='button'
                    variant='ghost'
                    size='icon'
                    className='h-7 w-7'
                    aria-label={t('chat.webSearch.label')}
                    aria-pressed={webSearchEnabled}
                    onMouseDown={(event) => event.preventDefault()}
                    onClick={() => setWebSearchEnabled((enabled) => !enabled)}
                  >
                    <EarthIcon className={`h-4 w-4 ${webSearchEnabled ? 'text-primary' : 'text-icon-secondary'}`} />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>{t(webSearchEnabled ? 'chat.webSearch.active' : 'chat.webSearch.label')}</TooltipContent>
              </Tooltip>
            </div>
            <Button
              type='submit'
              variant='ghost'
              size='icon-lg'
              className='rounded-full p-0'
              aria-label={t('document.plugins.pdf.send')}
              disabled={!input.trim()}
            >
              {input.trim() ? <SendIcon width={24} height={24} /> : <SendDisabledIcon width={24} height={24} />}
            </Button>
          </div>
        </form>
      )}
    </section>
  );
}
