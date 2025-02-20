import { useAIChatContext } from '@/components/ai-chat/AIChatProvider';
import { useAppHandlers, useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { useCurrentUser, useService } from '@/components/main/app.hooks';
import { getPlatform } from '@/utils/platform';
import { downloadPage } from '@/utils/url';
import { Button, Dialog, DialogActions, DialogContent, DialogTitle } from '@mui/material';
import React, { useEffect, useMemo } from 'react';
import '@appflowyinc/ai-chat/style';
import { Chat, ChatRequest } from '@appflowyinc/ai-chat';

export function AIChat({
  chatId,
  onRendered,
}: {
  chatId: string,
  onRendered?: () => void;
}) {
  const service = useService();
  const workspaceId = useCurrentWorkspaceId();
  const currentUser = useCurrentUser();
  const isMobile = getPlatform().isMobile;
  const [openMobilePrompt, setOpenMobilePrompt] = React.useState(isMobile);

  const {
    refreshOutline,
    updatePage,
  } = useAppHandlers();

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
    if(!service || !workspaceId) return;
    const axiosInstance = service.getAxiosInstance();

    if(!axiosInstance) return;

    const request = new ChatRequest(workspaceId, chatId, axiosInstance);

    const { createViewWithContent } = request;

    request.updateViewName = async(view, name) => {
      try {
        await updatePage?.(view.view_id, {
          name,
          icon: view.icon || undefined,
        });
        void refreshOutline?.();
      } catch(error) {
        return Promise.reject(error);
      }
    };

    request.insertContentToView = async(viewId, data) => {
      onOpenView(viewId, data);
    };

    request.createViewWithContent = async(parentViewId, name, data) => {
      try {
        const res = await createViewWithContent.apply(request, [parentViewId, name, data]);

        await refreshOutline?.();
        onOpenView(res.view_id);

        return res;
      } catch(error) {
        return Promise.reject(error);
      }
    };

    return request;
  }, [onOpenView, service, workspaceId, chatId, updatePage, refreshOutline]);

  useEffect(() => {
    if(onRendered) {
      onRendered();
    }
  }, [onRendered]);

  if(!requestInstance) return null;

  return (
    <div
      style={{
        height: 'calc(100vh - 48px)',
      }}
      className={'relative flex transform w-full justify-center'}
    >
      <div className={'max-w-full w-[988px] px-24 max-sm:px-6'}>
        <Chat
          requestInstance={requestInstance}
          chatId={chatId}
          currentUser={currentUser ? {
            uuid: currentUser.uuid,
            name: currentUser.name || '',
            email: currentUser.email || '',
            avatar: currentUser.avatar || '',
          } : undefined}
          selectionMode={selectionMode}
          onOpenSelectionMode={handleOpenSelectionMode}
          onCloseSelectionMode={handleCloseSelectionMode}
          openingViewId={(drawerOpen && openViewId) || undefined}
          onCloseView={onCloseView}
          onOpenView={onOpenView}
        />
      </div>

      {<Dialog
        open={openMobilePrompt}
        keepMounted={false}
      >
        <DialogTitle>
          {'📱 Mobile device detected'}
        </DialogTitle>
        <DialogContent>
          <div className={'text-base mb-2'}>{`Chat listings only. For full chat features:`}</div>
          <ul className={'px-2 text-text-caption'}>
            <li>• Use desktop browser</li>
            <li>• Download AppFlowy's mobile app</li>
          </ul>
        </DialogContent>
        <DialogActions className={'w-full p-4 flex items-center justify-center gap-2'}>
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
      </Dialog>}
    </div>

  );
}

export default AIChat;