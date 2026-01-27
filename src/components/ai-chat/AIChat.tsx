import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import React, { useEffect, useMemo } from 'react';

import { getUserIconUrl } from '@/application/user-metadata';
import { useAIChatContext } from '@/components/ai-chat/AIChatProvider';
import { useAppHandlers, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useCurrentUserWorkspaceAvatar } from '@/components/app/useWorkspaceMemberProfile';
import { Chat, ChatRequest } from '@/components/chat';
import { useCurrentUser, useService } from '@/components/main/app.hooks';
import { getPlatform } from '@/utils/platform';
import { downloadPage } from '@/utils/url';


export function AIChat({ chatId, onRendered }: { chatId: string; onRendered?: () => void }) {
  const service = useService();
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

  const { refreshOutline, updatePage, loadDatabasePrompts, testDatabasePromptConfig } = useAppHandlers();

  const {
    selectionMode,
    onOpenSelectionMode: handleOpenSelectionMode,
    onCloseSelectionMode: handleCloseSelectionMode,
    onOpenView,
    openViewId,
    onCloseView,
    drawerOpen,
  } = useAIChatContext();

  const requestInstance = useMemo(() => {
    if (!service || !workspaceId) return;
    const axiosInstance = service.getAxiosInstance();

    if (!axiosInstance) return;

    const request = new ChatRequest(workspaceId, chatId, axiosInstance);

    const { createViewWithContent } = request;

    request.updateViewName = async (view, name) => {
      try {
        await updatePage?.(view.view_id, {
          name,
          icon: view.icon || undefined,
        });
        void refreshOutline?.();
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

        await refreshOutline?.();
        onOpenView(res.view_id);

        return res;
      } catch (error) {
        return Promise.reject(error);
      }
    };

    return request;
  }, [onOpenView, service, workspaceId, chatId, updatePage, refreshOutline]);

  useEffect(() => {
    if (onRendered) {
      onRendered();
    }
  }, [onRendered]);

  if (!requestInstance || !workspaceId) return null;

  return (
    <div
      data-testid="ai-chat-container"
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
          onOpenView={onOpenView}
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
