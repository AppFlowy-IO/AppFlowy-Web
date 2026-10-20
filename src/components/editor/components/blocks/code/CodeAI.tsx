import { TextareaAutosize } from '@mui/material';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Editor, Node, Transforms } from 'slate';
import { useReadOnly, useSlateStatic } from 'slate-react';

import { getAxios } from '@/application/services/js-services/http/core';
import { YjsEditor } from '@/application/slate-yjs';
import { CustomEditor } from '@/application/slate-yjs/command';
import { findSlateEntryByBlockId } from '@/application/slate-yjs/utils/editor';
import { BlockType } from '@/application/types';
import { ReactComponent as AcceptIcon } from '@/assets/icons/code-block/accept.svg';
import { ReactComponent as AIIcon } from '@/assets/icons/code-block/ai-group.svg';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/code-block/arrow-down.svg';
import { ReactComponent as DismissIcon } from '@/assets/icons/code-block/dismiss.svg';
import { ReactComponent as InsertIcon } from '@/assets/icons/code-block/insert.svg';
import { ReactComponent as RetryIcon } from '@/assets/icons/code-block/retry.svg';
import { ReactComponent as SendDisabledIcon } from '@/assets/icons/code-block/send-disabled.svg';
import { ReactComponent as SendIcon } from '@/assets/icons/code-block/send.svg';
import { ModelSelector } from '@/components/chat/components/chat-input/model-selector';
import { ModelSelectorContext } from '@/components/chat/contexts/model-selector-context';
import { WriterRequest } from '@/components/chat/request/writer-request';
import { AIAssistantType, CompletionResult, CompletionRole } from '@/components/chat/types/writer';
import { CodeAIAction } from '@/components/editor/components/block-popover/BlockPopoverContext';
import { CodeNode } from '@/components/editor/editor.type';
import { useEditorContext } from '@/components/editor/EditorContext';
import { parseMarkdown } from '@/components/editor/parsers/markdown-parser';
import { parsedBlockToSlateElement } from '@/components/editor/parsers/parsed-block-to-slate';
import { insertBlocksAtCaret } from '@/components/editor/utils/insert-blocks-at-caret';
import { Button } from '@/components/ui/button';

import { codePrompts, extractGeneratedCode } from './code-ai';
import { CodeAILoading } from './CodeAILoading';
import { CodeResponse } from './CodeResponse';
import { normalizeCodeLanguage } from './constants';

type CodeAIError = { translation: 'aiUnavailable' | 'changedDuringAI' } | { message: string };

export default function CodeAI({
  node,
  action,
  onClose,
}: {
  node: CodeNode;
  action: CodeAIAction;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const editor = useSlateStatic() as YjsEditor;
  const readOnly = useReadOnly();
  const { workspaceId, viewId } = useEditorContext();
  const [original] = useState(() => Node.string(node));
  const [originalLanguage] = useState(node.data.language);
  const [prompt, setPrompt] = useState(() =>
    action === 'generate' ? t('document.plugins.codeBlock.generateTemplate') : ''
  );
  const [answer, setAnswer] = useState('');
  const [loading, setLoading] = useState(false);
  const [complete, setComplete] = useState(false);
  const [model, setModel] = useState('Auto');
  const [error, setError] = useState<CodeAIError>();
  const errorMessage =
    error && ('translation' in error ? t(`document.plugins.codeBlock.${error.translation}`) : error.message);
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
  const titleKey = (
    { generate: 'askAI', explain: 'explainCode', check: 'checkCode', comments: 'addInlineCodeComments' } as const
  )[action];
  const title = t(`document.plugins.codeBlock.${titleKey}`);
  const generated = useMemo(() => extractGeneratedCode(answer), [answer]);
  const changed = Node.string(node) !== original || node.data.language !== originalLanguage;
  const cancel = useCallback(() => {
    ++generation.current;
    pending.current?.abort();
  }, []);
  const stop = () => {
    cancel();
    setLoading(false);
  };

  const submit = useCallback(
    async (question: string, modelName: string, retry = false) => {
      pending.current?.abort();
      const controller = new AbortController();
      const id = ++generation.current;

      pending.current = controller;
      setLoading(true);
      setComplete(false);
      setAnswer('');
      setError(undefined);
      lastPrompt.current = question;
      try {
        if (!workspaceId || !getAxios()) {
          setError({ translation: 'aiUnavailable' });
          return;
        }

        const input = `Language: ${originalLanguage || 'auto'}\nCode:\n${original}\n\n${question}`;
        const previous = retry ? previousHistory.current : history.current;

        previousHistory.current = previous;
        let result = '';
        const { streamPromise } = await request.fetchAIAssistant(
          {
            inputText: input,
            assistantType: AIAssistantType.CustomPrompt,
            customPrompt: codePrompts[action],
            ragIds: [],
            completionHistory: previous,
            modelName,
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
          setError({ message: failure instanceof Error ? failure.message : String(failure) });
      } finally {
        if (id === generation.current && !controller.signal.aborted) setLoading(false);
      }
    },
    [original, originalLanguage, request, action, workspaceId]
  );

  useEffect(() => {
    if (action !== 'generate') void submit('', 'Auto');
    return cancel;
  }, [action, submit, cancel]);

  const insert = (below = false) => {
    const entry = findSlateEntryByBlockId(editor, node.blockId);

    if (
      !complete ||
      readOnly ||
      editor.readOnly ||
      !entry ||
      entry[0].type !== BlockType.CodeBlock ||
      editor.isElementReadOnly(entry[0])
    )
      return;
    if (Node.string(entry[0]) !== original || (entry[0] as CodeNode).data.language !== originalLanguage) {
      setError({ translation: 'changedDuringAI' });
      return;
    }

    if (below || action === 'explain' || (action === 'check' && !generated)) {
      const blocks = parseMarkdown(answer).map(parsedBlockToSlateElement);

      editor.select(editor.end(entry[1]));
      if (!insertBlocksAtCaret(editor, blocks, { mergeFirstBlockInline: false })) return;
    } else {
      if (!generated) return;
      Editor.withoutNormalizing(editor, () => {
        Transforms.insertText(editor, generated.text, { at: Editor.range(editor, entry[1].concat(0)) });
        if (!original.trim() && generated.language)
          CustomEditor.setBlockData(editor, node.blockId, { language: normalizeCodeLanguage(generated.language) });
      });
    }

    onClose();
  };

  if (readOnly) return null;
  return (
    <section
      aria-label={title}
      data-testid='code-block-ai'
      contentEditable={false}
      onClick={(event) => event.stopPropagation()}
      className='mt-1 overflow-hidden rounded-xl border border-border-primary bg-surface-layer-02 text-sm shadow-menu'
    >
      {(answer || error || complete) && (
        <div className='flex flex-col gap-1 border-b border-border-primary bg-surface-container-layer-01 px-3 pb-4 pt-3'>
          <div className='text-xs font-medium leading-[18px] tracking-[0.1px] text-text-secondary'>{title}</div>
          {answer && (
            <div className='max-h-[440px] overflow-y-auto' aria-busy={loading}>
              <CodeResponse content={answer} />
            </div>
          )}
          {complete && (action === 'generate' || action === 'comments') && !generated && !error && (
            <div role='status'>{t('document.plugins.codeBlock.noCode')}</div>
          )}
          {error && (
            <div role='alert' className='text-text-error'>
              {errorMessage}
            </div>
          )}
          {changed && (
            <div role='alert' className='text-text-error'>
              {t('document.plugins.codeBlock.changedDuringAI')}
            </div>
          )}
          {!loading && (
            <div className='flex flex-wrap gap-1'>
              <Button
                variant='ghost'
                className='h-7 px-2'
                disabled={
                  !complete ||
                  !answer ||
                  !!error ||
                  changed ||
                  ((action === 'generate' || action === 'comments') && !generated)
                }
                onClick={() => insert()}
              >
                {action === 'explain' || (action === 'check' && !generated) ? (
                  <InsertIcon width={20} height={20} />
                ) : (
                  <AcceptIcon width={20} height={20} />
                )}
                {t(
                  action === 'explain' || (action === 'check' && !generated)
                    ? 'button.insertBelow'
                    : 'document.plugins.codeBlock.keep'
                )}
              </Button>
              {action !== 'explain' && !(action === 'check' && !generated) && (
                <Button
                  variant='ghost'
                  className='h-7 px-2'
                  disabled={!complete || !answer || !!error || changed}
                  onClick={() => insert(true)}
                >
                  <InsertIcon width={20} height={20} />
                  {t('button.insertBelow')}
                </Button>
              )}
              <Button
                variant='ghost'
                className='h-7 px-2'
                onClick={() => {
                  void submit(lastPrompt.current, model, true);
                }}
              >
                <RetryIcon width={20} height={20} />
                {t('button.tryAgain')}
              </Button>
              <Button variant='ghost' className='h-7 px-2' onClick={onClose}>
                <DismissIcon width={20} height={20} />
                {t(action === 'explain' || (action === 'check' && !generated) ? 'button.close' : 'button.discard')}
              </Button>
            </div>
          )}
        </div>
      )}
      {loading ? (
        <CodeAILoading onStop={stop} />
      ) : (
        <form
          className='flex flex-col gap-2 p-3'
          onSubmit={(event) => {
            event.preventDefault();
            if (prompt.trim()) {
              void submit(prompt, model);
              setPrompt('');
            }
          }}
        >
          <TextareaAutosize
            autoFocus
            minRows={2}
            maxRows={10}
            aria-label={t('document.plugins.codeBlock.askAI')}
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
                aria-label={t('document.plugins.codeBlock.send')}
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
