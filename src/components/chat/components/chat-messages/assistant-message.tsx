import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as Error } from '@/assets/icons/error.svg';
import { ReactComponent as ChevronIcon } from '@/assets/icons/triangle_down.svg';
import { useIsOfficialHosted } from '@/components/app/app.hooks';
import { Alert, AlertDescription } from '@/components/chat/components/ui/alert';
import LoadingDots from '@/components/chat/components/ui/loading-dots';
import { ERROR_CODE_NO_LIMIT } from '@/components/chat/lib/const';
import { useMessagesHandlerContext } from '@/components/chat/provider/messages-handler-provider';
import { useChatMessagesContext } from '@/components/chat/provider/messages-provider';
import { useResponseFormatContext } from '@/components/chat/provider/response-format-provider';
import { useSuggestionsContext } from '@/components/chat/provider/suggestions-provider';
import { ChatMessageMetadata, ResponseFormat } from '@/components/chat/types';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getErrorMessage, isAPIErrorCode } from '@/utils/errors';

import { AnswerMd } from '../chat-messages/answer-md';
import { MessageActions } from '../chat-messages/message-actions';
import { ResolvedMessageSources, useResolvedMessageSources } from '../chat-messages/message-sources';
import { MessageSuggestions } from '../chat-messages/message-suggestions';

import MessageCheckbox from './message-checkbox';

const MAX_PROGRESS_STEPS = 5;

export function AssistantMessage({ id, isHovered }: { id: number; isHovered: boolean }) {
  const isOfficialHosted = useIsOfficialHosted();
  const hasStarted = useRef(false);
  const { getMessage } = useChatMessagesContext();
  const { resolveAnswerFormat } = useResponseFormatContext();
  const { fetchAnswerStream, regenerateAnswer } = useMessagesHandlerContext();

  const { getMessageSuggestions } = useSuggestionsContext();

  const message = getMessage(id);

  const questionId = id - 1;
  // Sources streamed before the answer is saved let citations resolve while it types.
  const [streamSources, setStreamSources] = useState<ChatMessageMetadata[]>([]);
  const savedSources = message?.meta_data;
  const resolvedSources = useResolvedMessageSources(savedSources?.length ? savedSources : streamSources);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<{ message: string; isResponseLimit: boolean } | null>(null);
  const [content, setContent] = useState<string>('');
  const [done, setDone] = useState<boolean>(false);
  const [progressSteps, setProgressSteps] = useState<{ id: number; text: string }[]>([]);
  const [reasoning, setReasoning] = useState('');
  // undefined keeps the automatic behavior: open while thinking, collapsed once the answer starts.
  const [reasoningOpen, setReasoningOpen] = useState<boolean | undefined>(undefined);
  const stepIdRef = useRef(0);
  const formatRef = useRef<ResponseFormat | undefined>(undefined);

  const { t } = useTranslation();

  const handleProgress = useCallback((step: string) => {
    const id = ++stepIdRef.current;

    setProgressSteps((prev) => {
      const next = [...prev, { id, text: step }];

      return next.length > MAX_PROGRESS_STEPS ? next.slice(-MAX_PROGRESS_STEPS) : next;
    });
  }, []);

  const run = useCallback(async () => {
    setLoading(true);
    setError(null);
    setDone(false);
    setProgressSteps([]);
    setReasoning('');
    setReasoningOpen(undefined);
    setStreamSources([]);

    // The format chosen when the question was sent wins over whatever the
    // input shows now, so a regenerated image answer stays an image answer.
    const format = resolveAnswerFormat(id, message?.content);

    formatRef.current = format;

    try {
      await fetchAnswerStream(
        questionId,
        format,
        (text, done, metadata) => {
          if (done || text) {
            setLoading(false);
          }

          if (metadata && metadata.length > 0) {
            setStreamSources(metadata);
          }

          setDone(done || false);
          setContent(text);
        },
        handleProgress,
        setReasoning
      );
    } catch (e) {
      console.error(e);
      setError({
        message: getErrorMessage(e, '') || t('chat.errors.responseUnavailable'),
        isResponseLimit: isAPIErrorCode(e, ERROR_CODE_NO_LIMIT),
      });
      setLoading(false);
    }
  }, [fetchAnswerStream, handleProgress, id, message?.content, questionId, resolveAnswerFormat, t]);

  useEffect(() => {
    if (!questionId || hasStarted.current) return;
    hasStarted.current = true;
    void run();
  }, [questionId, run]);

  const handleRegenerateImage = useCallback(() => {
    void regenerateAnswer(questionId, formatRef.current);
  }, [questionId, regenerateAnswer]);

  const suggestions = useMemo(() => {
    if (!questionId) return null;
    return getMessageSuggestions(questionId);
  }, [questionId, getMessageSuggestions]);

  const thinking = loading && !content;
  const showReasoning = reasoningOpen ?? thinking;
  // Work that continues after the text, such as image generation, reports progress here.
  const trailingStep = !loading && !done && progressSteps.length > 0 ? progressSteps[progressSteps.length - 1] : null;

  return (
    <div className={'assistant-message relative flex w-full transform flex-col gap-1 transition-transform'}>
      {reasoning ? (
        <div className={'flex flex-col gap-1 pl-0.5'} data-testid='chat-reasoning'>
          <button
            type='button'
            aria-expanded={showReasoning}
            onClick={() => setReasoningOpen(!showReasoning)}
            className={'flex w-fit items-center gap-1 text-xs text-text-secondary hover:text-foreground'}
          >
            <ChevronIcon className={cn('h-3 w-3 transition-transform', showReasoning ? '' : '-rotate-90')} />
            {thinking ? t('chat.reasoning.thinking') : t('chat.reasoning.thought')}
          </button>
          {showReasoning ? (
            <div
              className={
                'max-h-[240px] overflow-y-auto whitespace-pre-wrap border-l-2 border-border-primary pl-3 text-xs text-text-secondary'
              }
            >
              {reasoning}
            </div>
          ) : null}
        </div>
      ) : null}
      {loading ? (
        <div className={'flex flex-col gap-1 overflow-hidden pl-0.5'}>
          {progressSteps.length > 0 ? (
            <>
              {progressSteps.map((step, i) => (
                <div
                  key={step.id}
                  className={`flex items-center gap-2 ${i === progressSteps.length - 1 ? 'opacity-100' : 'opacity-50'}`}
                >
                  <span className={'text-sm text-foreground'}>{step.text}</span>
                </div>
              ))}
              <LoadingDots />
            </>
          ) : (
            <div className={'flex items-center gap-2'}>
              <span className={'text-sm text-foreground opacity-60'}>{t('chat.generating')}</span>
              <LoadingDots />
            </div>
          )}
        </div>
      ) : (
        content && (
          <div className={'flex w-full gap-2 overflow-hidden py-1 pl-0.5'}>
            <MessageCheckbox id={id} />
            <AnswerMd
              id={id}
              mdContent={content}
              sources={resolvedSources}
              onRegenerateImage={handleRegenerateImage}
              streaming={!done}
            />
          </div>
        )
      )}
      {trailingStep ? (
        <div className={'flex items-center gap-2 pl-0.5'} data-testid='chat-answer-progress'>
          <span className={'text-sm text-foreground opacity-60'}>{trailingStep.text}</span>
          <LoadingDots />
        </div>
      ) : null}
      {error ? (
        <div className={`flex w-full items-center justify-center`}>
          <div className='max-w-[480px]'>
            <Alert className={'border-none bg-fill-error-light text-foreground'}>
              <AlertDescription>
                <div className='flex items-center gap-3'>
                  <Error className='!min-h-5 !min-w-5 text-icon-error-thick' />
                  <span>{isOfficialHosted && error.isResponseLimit ? t('chat.errors.responseLimit') : error.message}</span>
                  {!error.isResponseLimit ? (
                    <Button
                      variant={'outline'}
                      size={'sm'}
                      className={'ml-auto shrink-0'}
                      data-testid='chat-answer-retry'
                      onClick={() => void run()}
                    >
                      {t('chat.retry')}
                    </Button>
                  ) : null}
                </div>
              </AlertDescription>
            </Alert>
          </div>
        </div>
      ) : null}
      {resolvedSources.length > 0 ? <ResolvedMessageSources sources={resolvedSources} /> : null}
      {done && <MessageActions id={id} isHovered={isHovered} />}
      {suggestions && suggestions.items.length > 0 ? <MessageSuggestions suggestions={suggestions} /> : null}
    </div>
  );
}
