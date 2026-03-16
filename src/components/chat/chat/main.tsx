// Code: Chat main component
import { AnimatePresence, motion } from 'framer-motion';
import { useCallback, useMemo } from 'react';

import { ChatInput } from '@/components/chat/components/chat-input';
import { ChatMessages } from '@/components/chat/components/chat-messages';
import { ModelSelectorContext } from '@/components/chat/contexts/model-selector-context';
import { EditorProvider } from '@/components/chat/provider/editor-provider';
import { MessageAnimationProvider } from '@/components/chat/provider/message-animation-provider';
import { MessagesHandlerProvider, useMessagesHandlerContext } from '@/components/chat/provider/messages-handler-provider';
import { ChatMessagesProvider } from '@/components/chat/provider/messages-provider';
import { PromptModalProvider } from '@/components/chat/provider/prompt-modal-provider';
import { ResponseFormatProvider } from '@/components/chat/provider/response-format-provider';
import { SelectionModeProvider } from '@/components/chat/provider/selection-mode-provider';
import { SuggestionsProvider } from '@/components/chat/provider/suggestions-provider';
import { ViewLoaderProvider } from '@/components/chat/provider/view-loader-provider';
import { ChatProps, User } from '@/components/chat/types';
import { cn } from '@/lib/utils';

import { ChatContext, useChatContext } from './context';

// Component to bridge ModelSelector with MessagesHandler
function ChatContentWithModelSync({ currentUser, selectionMode }: { currentUser?: User; selectionMode?: boolean }) {
  const { selectedModelName, setSelectedModelName } = useMessagesHandlerContext();
  const { requestInstance, chatId } = useChatContext();
  const modelRequestInstance = useMemo(
    () => ({
      getModelList: () => requestInstance.getModelList(),
      getCurrentModel: async () => {
        const settings = await requestInstance.getChatSettings();

        return settings.metadata?.ai_model as string | undefined || '';
      },
      setCurrentModel: async (modelName: string) => {
        await requestInstance.updateChatSettings({
          metadata: {
            ai_model: modelName
          }
        });
      },
    }),
    [requestInstance]
  );
  const modelSelectorValue = useMemo(
    () => ({
      selectedModelName,
      setSelectedModelName,
      requestInstance: modelRequestInstance,
      chatId,
    }),
    [selectedModelName, setSelectedModelName, modelRequestInstance, chatId]
  );

  return (
    <ModelSelectorContext.Provider value={modelSelectorValue}>
      <div className={'w-full relative h-full flex flex-col'}>
        <ChatMessages currentUser={currentUser} />
        <motion.div
          layout
          className={cn(
            'w-full relative flex pb-6 justify-center max-sm:hidden',
          )}
        >
          <AnimatePresence mode='wait'>
            {!selectionMode && <ChatInput />}
          </AnimatePresence>
        </motion.div>
      </div>
    </ModelSelectorContext.Provider>
  );
}

function Main(props: ChatProps) {
  const {
    workspaceId,
    chatId,
    requestInstance,
    currentUser,
    openingViewId,
    onOpenView,
    onCloseView,
    selectionMode,
    onOpenSelectionMode,
    onCloseSelectionMode,
    loadDatabasePrompts,
    testDatabasePromptConfig,
  } = props;
  const chatContextValue = useMemo<ChatProps>(
    () => ({
      workspaceId,
      chatId,
      requestInstance,
      currentUser,
      openingViewId,
      onOpenView,
      onCloseView,
      selectionMode,
      onOpenSelectionMode,
      onCloseSelectionMode,
      loadDatabasePrompts,
      testDatabasePromptConfig,
    }),
    [
      workspaceId,
      chatId,
      requestInstance,
      currentUser,
      openingViewId,
      onOpenView,
      onCloseView,
      selectionMode,
      onOpenSelectionMode,
      onCloseSelectionMode,
      loadDatabasePrompts,
      testDatabasePromptConfig,
    ]
  );
  const getView = useCallback(
    (viewId: string, forceRefresh?: boolean) => requestInstance.getView(viewId, forceRefresh),
    [requestInstance]
  );
  const fetchViews = useCallback(
    (forceRefresh?: boolean) => requestInstance.fetchViews(forceRefresh),
    [requestInstance]
  );

  return (
    <ChatContext.Provider value={chatContextValue}>
      <ChatMessagesProvider>
        <MessageAnimationProvider>
          <SuggestionsProvider>
            <EditorProvider>
              <ViewLoaderProvider
                getView={getView}
                fetchViews={fetchViews}
              >
                <SelectionModeProvider>
                  <ResponseFormatProvider>
                    <PromptModalProvider
                      workspaceId={workspaceId}
                      loadDatabasePrompts={loadDatabasePrompts}
                      testDatabasePromptConfig={testDatabasePromptConfig}
                    >
                      <MessagesHandlerProvider>
                        <ChatContentWithModelSync currentUser={currentUser} selectionMode={selectionMode} />
                      </MessagesHandlerProvider>
                    </PromptModalProvider>
                  </ResponseFormatProvider>
                </SelectionModeProvider>
              </ViewLoaderProvider>
            </EditorProvider>
          </SuggestionsProvider>
        </MessageAnimationProvider>
      </ChatMessagesProvider>
    </ChatContext.Provider>
  );
}

export default Main;
