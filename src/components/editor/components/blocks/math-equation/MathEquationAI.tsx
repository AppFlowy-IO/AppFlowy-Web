import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { getAxios } from '@/application/services/js-services/http/core';
import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { ReactComponent as AcceptIcon } from '@/assets/icons/math-equation/accept.svg';
import { ReactComponent as AIIcon } from '@/assets/icons/math-equation/ai-group.svg';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/math-equation/arrow-down.svg';
import { ReactComponent as DismissIcon } from '@/assets/icons/math-equation/dismiss.svg';
import { ReactComponent as InsertIcon } from '@/assets/icons/math-equation/insert.svg';
import { ReactComponent as RetryIcon } from '@/assets/icons/math-equation/retry.svg';
import { ReactComponent as SendDisabledIcon } from '@/assets/icons/math-equation/send-disabled.svg';
import { ReactComponent as SendIcon } from '@/assets/icons/math-equation/send.svg';
import { ModelSelector } from '@/components/chat/components/chat-input/model-selector';
import { ModelSelectorContext } from '@/components/chat/contexts/model-selector-context';
import { WriterRequest } from '@/components/chat/request/writer-request';
import { AIAssistantType, CompletionResult, CompletionRole } from '@/components/chat/types/writer';
import { MathEquationAISession } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { MathEquationNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { parsedBlockToSlateElement } from '@/components/editor/parsers/parsed-block-to-slate';
import { insertBlocksAtCaret } from '@/components/editor/utils/insert-blocks-at-caret';
import { Button } from '@/components/ui/button';

import { equationPrompts, extractGeneratedEquation, parseEquationResponse } from './math-equation-ai';
import { MathEquationAILoading } from './MathEquationAILoading';
import { MathEquationResponse } from './MathEquationResponse';

export default function MathEquationAI({
  node,
  session,
  onClose,
}: {
  node: MathEquationNode;
  session: MathEquationAISession;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const readOnly = useReadOnly();
  const { workspaceId, viewId } = useEditorContext();
  const [original] = useState(node.data.formula || '');
  const [prompt, setPrompt] = useState(session.draft ?? '');
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [model, setModel] = useState('Auto');
  const modelRef = useRef(model);

  modelRef.current = model;
  const [error, setError] = useState('');
  const lastPrompt = useRef('');
  const history = useRef<CompletionResult[]>([]);
  const previousHistory = useRef<CompletionResult[]>([]);
  const request = useMemo(() => new WriterRequest(workspaceId, viewId, getAxios() ?? undefined), [workspaceId, viewId]);
  const modelContext = useMemo(
    () => ({ selectedModelName: model, setSelectedModelName: setModel, requestInstance: request }),
    [model, request]
  );
  const pending = useRef<AbortController>();
  const generation = useRef(0);
  const title = t(`document.plugins.mathEquation.${session.action === 'generate' ? 'askAI' : session.action}`);
  const formula = useMemo(() => extractGeneratedEquation(answer), [answer]);
  const changed = (node.data.formula || '') !== original;
  const cancel = useCallback(() => {
    ++generation.current;
    pending.current?.abort();
  }, []);
  const stop = () => {
    cancel();
    setLoading(false);
  };

  const submit = useCallback(
    async (question: string, retry = false) => {
      pending.current?.abort();
      const controller = new AbortController();
      const id = ++generation.current;

      pending.current = controller;
      setLoading(true);
      setComplete(false);
      setAnswer('');
      setError('');
      lastPrompt.current = question;
      try {
        if (!workspaceId || !getAxios()) throw new Error(t('document.plugins.mathEquation.aiUnavailable'));
        const input = `${original ? `Equation:\n$$\n${original}\n$$\n\n` : ''}${question}`;
        const previous = retry ? previousHistory.current : history.current;

        previousHistory.current = previous;
        let result = '';
        const { streamPromise } = await request.fetchAIAssistant(
          {
            inputText: input,
            assistantType: AIAssistantType.CustomPrompt,
            customPrompt: equationPrompts[session.action],
            ragIds: [],
            completionHistory: previous,
            modelName: modelRef.current,
            signal: controller.signal,
          },
          (text, comment) => {
            if (id !== generation.current || controller.signal.aborted) return;
            result = [text, comment].filter(Boolean).join('\n\n');
            setAnswer(result);
          }
        );

        await streamPromise;
        if (id !== generation.current || controller.signal.aborted) return;
        history.current = [
          ...previous,
          { role: CompletionRole.Human, content: input },
          { role: CompletionRole.AI, content: result },
        ];
        setComplete(true);
      } catch (failure) {
        if (id === generation.current && !controller.signal.aborted)
          setError(failure instanceof Error ? failure.message : String(failure));
      } finally {
        if (id === generation.current && !controller.signal.aborted) setLoading(false);
      }
    },
    [original, request, session.action, t, workspaceId]
  );

  useEffect(() => {
    if (session.action !== 'generate') void submit('');
    return cancel;
  }, [session.action, submit, cancel]);

  const insert = () => {
    const entry = findSlateEntryByBlockId(editor, node.blockId);

    if (!complete || readOnly || editor.readOnly || !entry || editor.isElementReadOnly(entry[0])) return;
    if (((entry[0] as MathEquationNode).data.formula || '') !== original) {
      setError(t('document.plugins.mathEquation.changedDuringAI'));
      return;
    }

    if (session.action === 'explain' || (session.action === 'check' && !formula)) {
      const blocks = parseEquationResponse(answer).map(parsedBlockToSlateElement);

      editor.select(editor.end(entry[1]));
      if (!insertBlocksAtCaret(editor, blocks, { mergeFirstBlockInline: false })) return;
    } else {
      if (!formula) return;
      CustomEditor.setBlockData(editor, node.blockId, { formula });
    }

    onClose();
  };

  if (readOnly) return null;
  return (
    <section
      aria-label={title}
      data-testid='math-equation-ai'
      contentEditable={false}
      onClick={(event) => event.stopPropagation()}
      className='mt-1 overflow-hidden rounded-xl border border-border-primary bg-surface-layer-02 text-sm shadow-menu'
    >
      {(answer || error || complete) && (
        <div className='flex flex-col gap-1 border-b border-border-primary bg-surface-container-layer-01 px-3 pb-4 pt-3'>
          <div className='text-xs font-medium leading-[18px] tracking-[0.1px] text-text-secondary'>{title}</div>
          {answer && (
            <div className='max-h-[440px] overflow-y-auto' aria-busy={loading}>
              <MathEquationResponse content={answer} />
            </div>
          )}
          {complete && session.action === 'generate' && !formula && !error && (
            <div role='status'>{t('document.plugins.mathEquation.noEquation')}</div>
          )}
          {error && (
            <div role='alert' className='text-text-error'>
              {error}
            </div>
          )}
          {changed && (
            <div role='alert' className='text-text-error'>
              {t('document.plugins.mathEquation.changedDuringAI')}
            </div>
          )}
          {!loading && (
            <div className='flex flex-wrap gap-1'>
              <Button
                variant='ghost'
                className='h-7 px-2'
                disabled={!complete || !answer || !!error || changed || (session.action === 'generate' && !formula)}
                onClick={insert}
              >
                {session.action === 'explain' ? (
                  <InsertIcon width={20} height={20} />
                ) : (
                  <AcceptIcon width={20} height={20} />
                )}
                {t(session.action === 'explain' ? 'button.insertBelow' : 'document.plugins.mathEquation.insert')}
              </Button>
              <Button
                variant='ghost'
                className='h-7 px-2'
                onClick={() => {
                  void submit(lastPrompt.current, true);
                }}
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
      {loading ? (
        <MathEquationAILoading onStop={stop} />
      ) : (
        <form
          className='flex flex-col gap-2 p-3'
          onSubmit={(event) => {
            event.preventDefault();
            if (prompt.trim()) {
              void submit(prompt);
              setPrompt('');
            }
          }}
        >
          <textarea
            autoFocus
            aria-label={t('document.plugins.mathEquation.askAI')}
            placeholder={t('chat.input.placeholder')}
            className='min-h-[40px] w-full resize-none bg-transparent text-sm outline-none placeholder:text-text-tertiary'
            value={prompt}
            onChange={(event) => setPrompt(event.target.value)}
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
          <div className='flex items-center justify-between'>
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
            <div className='flex gap-2'>
              {!answer && !error && !complete && (
                <Button variant='ghost' type='button' onClick={onClose}>
                  {t('button.close')}
                </Button>
              )}
              <Button
                type='submit'
                variant='ghost'
                size='icon-lg'
                className='rounded-full p-0'
                aria-label={t('document.plugins.mathEquation.send')}
                disabled={!prompt.trim()}
              >
                {prompt.trim() ? <SendIcon width={32} height={32} /> : <SendDisabledIcon width={32} height={32} />}
              </Button>
            </div>
          </div>
        </form>
      )}
    </section>
  );
}
