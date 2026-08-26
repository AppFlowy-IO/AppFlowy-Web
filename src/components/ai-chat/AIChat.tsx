import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import React, { useEffect, useMemo } from 'react';

import { getUserIconUrl } from '@/application/user-metadata';
import { useAIChatContext } from '@/components/ai-chat/AIChatProvider';
import { useAppOperations, useCurrentWorkspaceId, useToView } from '@/components/app/app.hooks';
import { useCurrentUserWorkspaceAvatar } from '@/components/app/useWorkspaceMemberProfile';
import { Chat } from '@/components/chat/chat';
import { ChatRequest } from '@/components/chat/request/chat-request';
import { useCurrentUser } from '@/components/main/app.hooks';
import { getAxiosInstance } from '@/application/services/js-services/http';
import { getPlatform } from '@/utils/platform';
import { downloadPage } from '@/utils/url';

export function AIChat({ chatId, onRendered }: { chatId: string; onRendered?: () => void }) {
  const workspaceId = useCurrentWorkspaceId();
  const currentUser = useCurrentUser();
  const workspaceAvatar = useCurrentUserWorkspaceAvatar();
  const currentUserAvatar = useMemo(() => getUserIconUrl(currentUser, workspaceAvatar), [currentUser, workspaceAvatar]);
  const chatUser = useMemo(() => {
    if (!currentUser) return undefined;
    return {
      uuid: currentUser.uuid,
      name: currentUser.name || '',
      email: currentUser.email || '',
      avatar: currentUserAvatar,
    };
  }, [currentUser, currentUserAvatar]);
  const isMobile = getPlatform().isMobile;
  const [openMobilePrompt, setOpenMobilePrompt] = React.useState(isMobile);

  const { updatePage, loadDatabasePrompts, testDatabasePromptConfig } = useAppOperations();
  const toView = useToView();

  const {
    selectionMode,
    onOpenSelectionMode: handleOpenSelectionMode,
    onCloseSelectionMode: handleCloseSelectionMode,
    onOpenView,
    openViewId,
    onCloseView,
    drawerOpen,
  } = useAIChatContext();

  const handleOpenSource = React.useCallback(
    (viewId: string, rowId?: string) => {
      if (rowId) {
        void toView(viewId, rowId);
        return;
      }

      onOpenView(viewId);
    },
    [onOpenView, toView]
  );

  const requestInstance = useMemo(() => {
    if (!workspaceId) return;
    const axiosInstance = getAxiosInstance();

    if (!axiosInstance) return;

    const request = new ChatRequest(workspaceId, chatId, axiosInstance);

    const { createViewWithContent } = request;

    request.updateViewName = async (view, name) => {
      try {
        await updatePage?.(view.view_id, {
          name,
          icon: view.icon || undefined,
        });
        // Sidebar refresh is handled by WebSocket notification (FOLDER_OUTLINE_CHANGED)
      } catch (error) {
        return Promise.reject(error);
      }
    };

    request.insertContentToView = async (viewId, data) => {
      onOpenView(viewId, data);
    };

    request.createViewWithContent = async (parentViewId, name, data) => {
      try {
        const res = await createViewWithContent.apply(request, [parentViewId, name, data]);

        // Sidebar refresh is handled by WebSocket notification (FOLDER_OUTLINE_CHANGED)
        onOpenView(res.view_id);

        return res;
      } catch (error) {
        return Promise.reject(error);
      }
    };

    return request;
  }, [onOpenView, workspaceId, chatId, updatePage]);

  useEffect(() => {
    if (onRendered) {
      onRendered();
    }
  }, [onRendered]);

  if (!requestInstance || !workspaceId) return null;

  return (
    <div
      data-testid='ai-chat-container'
      style={{
        height: 'calc(100vh - 48px)',
      }}
      className={'relative flex w-full transform justify-center'}
    >
      <div className={'w-[952px] max-w-full px-24 max-sm:px-6'}>
        <Chat
          workspaceId={workspaceId}
          requestInstance={requestInstance}
          chatId={chatId}
          currentUser={chatUser}
          selectionMode={selectionMode}
          onOpenSelectionMode={handleOpenSelectionMode}
          onCloseSelectionMode={handleCloseSelectionMode}
          openingViewId={(drawerOpen && openViewId) || undefined}
          onCloseView={onCloseView}
          onOpenView={handleOpenSource}
          loadDatabasePrompts={loadDatabasePrompts}
          testDatabasePromptConfig={testDatabasePromptConfig}
        />
      </div>

      {
        <Dialog open={openMobilePrompt} keepMounted={false}>
          <DialogTitle>{'📱 Mobile device detected'}</DialogTitle>
          <DialogContent>
            <div className={'mb-2 text-base'}>{`Chat listings only. For full chat features:`}</div>
            <ul className={'px-2 text-text-secondary'}>
              <li>• Use desktop browser</li>
              <li>{`• Download AppFlowy's mobile app`}</li>
            </ul>
          </DialogContent>
          <DialogActions className={'flex w-full items-center justify-center gap-2 p-4'}>
            <Button
              variant={'contained'}
              className={'flex-1'}
              onClick={() => {
                window.open(downloadPage);
              }}
            >
              {'Get the App'}
            </Button>
            <Button
              className={'flex-1'}
              variant={'outlined'}
              color={'inherit'}
              onClick={() => {
                setOpenMobilePrompt(false);
              }}
            >
              {'Dismiss'}
            </Button>
          </DialogActions>
        </Dialog>
      }
    </div>
  );
}

export default AIChat;
