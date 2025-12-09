import { EditorData } from '@appflowyinc/editor';
import { findLast } from 'lodash-es';
import { ReactNode, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ConfirmDiscard } from '@/components/chat/components/ai-writer/confirm-discard';
import { ModelSelectorContext } from '@/components/chat/contexts/model-selector-context';

// Using main AppFlowy i18n system - no separate chat context needed
import { WriterRequest } from '@/components/chat/request';
import {
  AIAssistantType,
  ChatInputMode,
  CompletionResult,
  CompletionRole,
  OutputContent,
  OutputLayout,
  ResponseFormat,
} from '@/components/chat/types';
import { ApplyingState, WriterContext } from '@/components/chat/writer/context';
import { TooltipProvider } from '@/components/ui/tooltip';

import { usePromptModal } from './prompt-modal-provider';
import { ViewLoaderProvider } from './view-loader-provider';

export const AIAssistantProvider = ({
  isGlobalDocument,
  viewId,
  request,
  children,
  onReplace,
  onInsertBelow,
  onExit,
  scrollContainer,
}: {
  viewId: string;
  children: ReactNode;
  request: WriterRequest;
  onInsertBelow?: (data: EditorData) => void;
  onReplace?: (data: EditorData) => void;
  onExit?: () => void;
  isGlobalDocument?: boolean;
  scrollContainer?: HTMLElement;
}) => {
  const { t } = useTranslation();
  const completionHistoryRef = useRef<CompletionResult[]>([]);
  const [placeholderContent, setPlaceholderContent] = useState<string>('');
  const [comment, setComment] = useState<string>('');
  const [error, setError] = useState<{
    code: number;
    message: string;
  } | null>(null);
  const [editorData, setEditorData] = useState<EditorData>();
  const [assistantType, setAssistantType] = useState<AIAssistantType | undefined>(undefined);
  const lastAssistantTypeRef = useRef<AIAssistantType | undefined>(undefined);
  const [isFetching, setFetching] = useState<boolean>(false);
  const [responseMode, setResponseMode] = useState<ChatInputMode>(ChatInputMode.Auto);
  const [responseFormat, setResponseFormat] = useState<ResponseFormat>({
    output_layout: OutputLayout.BulletList,
    output_content: OutputContent.TEXT,
  });

  const [openDiscard, setOpenDiscard] = useState<boolean>(false);
  const [ragIds, setRagIds] = useState<string[]>([]);
  const [applyingState, setApplyingState] = useState<ApplyingState>(ApplyingState.idle);
  const isApplying = applyingState === ApplyingState.applying;
  const cancelRef = useRef<(() => void) | undefined>();
  const initialScrollTopRef = useRef<number | null>(null);
  const [selectedModelName, setSelectedModelName] = useState<string>('Auto');

  const { currentPromptId, updateCurrentPromptId, prompts } = usePromptModal();

  useEffect(() => {
    if (!assistantType) {
      cancelRef.current = undefined;
      completionHistoryRef.current = [];
      setResponseMode(ChatInputMode.Auto);
      setError(null);
      setResponseFormat({
        output_layout: OutputLayout.BulletList,
        output_content: OutputContent.TEXT,
      });
    }
  }, [assistantType]);

  const scrollToView = useCallback(() => {
    if (!initialScrollTopRef.current) {
      return;
    }

    const rect = document.getElementById('appflowy-ai-writer')?.getBoundingClientRect();

    if (rect && rect.top < 100) {
      scrollContainer?.scrollTo({
        top: initialScrollTopRef.current,
      });
    }

    initialScrollTopRef.current = null;
  }, [scrollContainer]);

  const handleMessageChange = useCallback(
    (text: string, comment: string, done?: boolean) => {
      setFetching(false);

      setPlaceholderContent(text);
      setComment(comment);
      setApplyingState(ApplyingState.applying);

      if (initialScrollTopRef.current === null) {
        initialScrollTopRef.current = scrollContainer?.scrollTop || null;
      }

      if (done) {
        cancelRef.current = undefined;
        setApplyingState(ApplyingState.completed);
        completionHistoryRef.current.push({
          role: CompletionRole.AI,
          content: text,
        });
      }
    },
    [scrollContainer]
  );

  const fetchRequest = useCallback(
    async (assistantType: AIAssistantType, content: string) => {
      // Do not change assistant type if there is already an AI response
      if (
        !completionHistoryRef.current.some((item) => {
          return item.role === CompletionRole.AI;
        })
      ) {
        lastAssistantTypeRef.current = assistantType;
        setAssistantType(assistantType);
      }

      setFetching(true);
      setError(null);
      try {
        setApplyingState(ApplyingState.analyzing);
        // Find the selected prompt to get its content for custom_prompt
        const selectedPrompt = currentPromptId
          ? prompts.find((p) => p.id === currentPromptId)
          : undefined;
        const { cancel, streamPromise } = await request.fetchAIAssistant(
          {
            inputText: content,
            assistantType: lastAssistantTypeRef.current || assistantType,
            format: responseMode === ChatInputMode.FormatResponse ? responseFormat : undefined,
            ragIds,
            completionHistory: completionHistoryRef.current,
            promptId: currentPromptId || undefined,
            customPrompt: selectedPrompt?.content,
            modelName: selectedModelName,
          },
          handleMessageChange
        );

        completionHistoryRef.current.push({
          role: CompletionRole.Human,
          content,
        });

        cancelRef.current = cancel;
        await streamPromise;
        return cancel;
        // eslint-disable-next-line
      } catch (e: any) {
        setError(e);
        setApplyingState(ApplyingState.failed);
      } finally {
        setFetching(false);
        updateCurrentPromptId(null);
      }

      return () => undefined;
    },
    [
      currentPromptId,
      handleMessageChange,
      prompts,
      ragIds,
      request,
      responseFormat,
      responseMode,
      selectedModelName,
      updateCurrentPromptId,
    ]
  );

  const improveWriting = useCallback(
    async (content: string) => {
      return fetchRequest(AIAssistantType.ImproveWriting, content);
    },
    [fetchRequest]
  );

  const askAIAnything = useCallback((content: string) => {
    completionHistoryRef.current.push({
      role: CompletionRole.Human,
      content,
    });
    setAssistantType(AIAssistantType.AskAIAnything);
  }, []);

  const askAIAnythingWithRequest = useCallback(
    (content: string) => {
      setApplyingState(ApplyingState.idle);
      setPlaceholderContent('');
      setComment('');
      setEditorData(undefined);
      scrollToView();
      return fetchRequest(AIAssistantType.AskAIAnything, content);
    },
    [scrollToView, fetchRequest]
  );

  const continueWriting = useCallback(
    async (content: string) => {
      return fetchRequest(AIAssistantType.ContinueWriting, content);
    },
    [fetchRequest]
  );

  const explain = useCallback(
    (content: string) => {
      return fetchRequest(AIAssistantType.Explain, content);
    },
    [fetchRequest]
  );

  const fixSpelling = useCallback(
    (content: string) => {
      return fetchRequest(AIAssistantType.FixSpelling, content);
    },
    [fetchRequest]
  );

  const makeLonger = useCallback(
    (content: string) => {
      return fetchRequest(AIAssistantType.MakeLonger, content);
    },
    [fetchRequest]
  );

  const makeShorter = useCallback(
    (content: string) => {
      return fetchRequest(AIAssistantType.MakeShorter, content);
    },
    [fetchRequest]
  );

  const stop = useCallback(() => {
    cancelRef.current?.();
    setApplyingState(ApplyingState.idle);
  }, []);

  const exit = useCallback(
    (scrollLocked?: boolean) => {
      cancelRef.current?.();
      setApplyingState(ApplyingState.idle);
      cancelRef.current = undefined;
      completionHistoryRef.current = [];

      setTimeout(() => {
        lastAssistantTypeRef.current = undefined;
        setAssistantType(undefined);
        setPlaceholderContent('');
        if (!scrollLocked) {
          scrollToView();
        }

        setComment('');
        setEditorData(undefined);
        onExit?.();
      }, 0);
    },
    [onExit, scrollToView]
  );

  const keep = useCallback(() => {
    if (!editorData) {
      return;
    }

    completionHistoryRef.current = [];

    if (isGlobalDocument) {
      onReplace?.(editorData);
    } else {
      onInsertBelow?.(editorData);
    }

    exit(true);
  }, [editorData, isGlobalDocument, exit, onReplace, onInsertBelow]);

  const accept = useCallback(() => {
    if (!editorData) {
      return;
    }

    completionHistoryRef.current = [];
    onReplace?.(editorData);
    exit(true);
  }, [editorData, onReplace, exit]);

  const rewrite = useCallback(() => {
    if (!assistantType) {
      toast.error(t('chat.writer.errors.noAssistantType'));
      return;
    }

    setApplyingState(ApplyingState.idle);
    setPlaceholderContent('');
    setComment('');
    setEditorData(undefined);
    scrollToView();
    const content =
      findLast(completionHistoryRef.current, (item) => {
        return item.role === CompletionRole.Human;
      })?.content || '';

    switch (assistantType) {
      case AIAssistantType.ImproveWriting:
        return improveWriting(content);
      case AIAssistantType.AskAIAnything:
        return askAIAnythingWithRequest(content);
      case AIAssistantType.ContinueWriting:
        return continueWriting(content);
      case AIAssistantType.Explain:
        return explain(content);
      case AIAssistantType.FixSpelling:
        return fixSpelling(content);
      case AIAssistantType.MakeLonger:
        return makeLonger(content);
      case AIAssistantType.MakeShorter:
        return makeShorter(content);
    }
  }, [
    scrollToView,
    assistantType,
    t,
    improveWriting,
    askAIAnythingWithRequest,
    continueWriting,
    explain,
    fixSpelling,
    makeLonger,
    makeShorter,
  ]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === 'c') {
        stop();
      }
    };

    document.addEventListener('keydown', handleKeyDown);

    return () => {
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [exit, stop]);

  const hasAIAnswer = useCallback(() => {
    return completionHistoryRef.current.some((item) => item.role === CompletionRole.AI);
  }, []);

  return (
    <ModelSelectorContext.Provider
      value={{
        selectedModelName,
        setSelectedModelName,
        requestInstance: {
          getModelList: () => request.getModelList(),
          getCurrentModel: async () => {
            // For writer context, get from localStorage
            return localStorage.getItem('writer_selected_model') || '';
          },
          setCurrentModel: async (modelName: string) => {
            // For writer context, save to localStorage
            localStorage.setItem('writer_selected_model', modelName);
          },
        },
      }}
    >
      <WriterContext.Provider
        value={{
          viewId,
          fetchViews: request.fetchViews,
          placeholderContent,
          comment,
          improveWriting,
          assistantType,
          isFetching,
          isApplying,
          askAIAnything,
          continueWriting,
          explain,
          fixSpelling,
          makeLonger,
          makeShorter,
          askAIAnythingWithRequest,
          setOpenDiscard,
          applyingState,
          setRagIds,
          exit,
          setEditorData,
          keep,
          accept,
          rewrite,
          stop,
          responseMode,
          setResponseMode,
          responseFormat,
          setResponseFormat,
          isGlobalDocument,
          error,
          scrollContainer,
          hasAIAnswer,
          selectedModelName,
          setSelectedModelName,
        }}
      >
        <TooltipProvider>
          <ViewLoaderProvider
            getView={(viewId: string) => request.getView(viewId)}
            fetchViews={() => request.fetchViews()}
          >
            {children}
            <ConfirmDiscard open={openDiscard} onClose={() => setOpenDiscard(false)} />
          </ViewLoaderProvider>
        </TooltipProvider>
      </WriterContext.Provider>
    </ModelSelectorContext.Provider>
  );
};
