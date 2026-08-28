import { Dialog, InputBase } from '@mui/material';
import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { View, ViewLayout } from '@/application/types';
import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as SearchIcon } from '@/assets/icons/search.svg';
import { notify } from '@/components/_shared/notify';
import { buildInitialAIChatSettings } from '@/components/ai-chat/chat-settings';
import { isSpaceView } from '@/components/ai-chat/rag-scope';
import type { AIChatRagSource } from '@/components/ai-chat/rag-scope';
import {
  useAIEnabled,
  useAppOperations,
  useAppOutline,
  useAppRecent,
  useAppViewId,
  useCurrentWorkspaceId,
  useToView,
} from '@/components/app/app.hooks';
import BestMatch from '@/components/app/search/BestMatch';
import RecentViews from '@/components/app/search/RecentViews';
import { findAncestors } from '@/components/chat/lib/views';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { createHotkey, createHotKeyLabel, HOT_KEY_NAME } from '@/utils/hotkeys';

function getFallbackAIChatParent(outline: View[] | undefined) {
  if (!outline?.length) return;

  return outline.find(isSpaceView) || outline[0];
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Something went wrong';
}

export function Search() {
  const [open, setOpen] = useState<boolean>(false);
  const { t } = useTranslation();
  const [searchValue, setSearchValue] = useState<string>('');
  const [askingAI, setAskingAI] = useState<boolean>(false);
  const outline = useAppOutline();
  const currentViewId = useAppViewId();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const aiEnabled = useAIEnabled();
  const { addPage } = useAppOperations();
  const toView = useToView();
  const handleClose = useCallback(() => {
    setOpen(false);
    setSearchValue('');
  }, []);

  const handleAskAI = useCallback(
    async (query: string, sources?: AIChatRagSource[]) => {
      if (!aiEnabled || !addPage || !currentWorkspaceId) return;

      setAskingAI(true);
      try {
        const [{ ChatRequest }, { getAxiosInstance }] = await Promise.all([
          import('@/components/chat/request'),
          import('@/application/services/js-services/http'),
        ]);
        const axiosInstance = getAxiosInstance();

        if (!axiosInstance) {
          throw new Error('Missing axios instance');
        }

        const scopeRequest = new ChatRequest(currentWorkspaceId, currentViewId, axiosInstance);
        let parentViewId: string | undefined;

        if (currentViewId) {
          const navigation = await scopeRequest.getViewNavigation(currentViewId);
          const currentPath = findAncestors([navigation], currentViewId);

          // Shared/private navigation can intentionally omit inaccessible space
          // ancestors. In that case the visible navigation root is the only
          // authoritative scope we can attach the new chat beneath.
          parentViewId = currentPath?.find(isSpaceView)?.view_id || currentPath?.[0]?.view_id;
        } else {
          parentViewId = getFallbackAIChatParent(outline)?.view_id;
        }

        if (!parentViewId) {
          notify.error(t('search.createAIChatFailed', { defaultValue: 'Unable to create an AI chat here' }));
          return;
        }

        const scopedParent = await scopeRequest.fetchCompleteView(parentViewId, true);
        const created = await addPage(scopedParent.view_id, {
          layout: ViewLayout.AIChat,
          name: query || t('chat.newChat', { defaultValue: 'New chat' }),
          prev_view_id: scopedParent.children?.[scopedParent.children.length - 1]?.view_id,
        });
        let settingsError: unknown;

        try {
          const request = new ChatRequest(currentWorkspaceId, created.view_id, axiosInstance);
          const initialSettings = buildInitialAIChatSettings({ parent: scopedParent, query, sources });

          if (Object.keys(initialSettings).length > 0) {
            await request.updateChatSettings(initialSettings);
          }
        } catch (error) {
          settingsError = error;
        }

        if (settingsError) {
          notify.error(
            t('search.updateAIChatSettingsFailed', {
              defaultValue: 'AI chat was created, but the context could not be attached',
            })
          );
        }

        await toView(created.view_id);
        handleClose();
      } catch (error) {
        notify.error(getErrorMessage(error));
      } finally {
        setAskingAI(false);
      }
    },
    [addPage, aiEnabled, currentViewId, currentWorkspaceId, handleClose, outline, t, toView]
  );

  const onKeyDown = useCallback((e: KeyboardEvent) => {
    switch (true) {
      case createHotkey(HOT_KEY_NAME.SEARCH)(e):
        e.preventDefault();
        setOpen(true);
        break;
      default:
        break;
    }
  }, []);

  useEffect(() => {
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
    };
  }, [onKeyDown]);

  const { recentViews, loadRecentViews } = useAppRecent();
  const [loadingRecentViews, setLoadingRecentViews] = useState<boolean>(false);

  useEffect(() => {
    if (!open) return;
    void (async () => {
      setLoadingRecentViews(true);
      await loadRecentViews?.();
      setLoadingRecentViews(false);
    })();
  }, [loadRecentViews, open]);

  return (
    <>
      <Tooltip delayDuration={1000}>
        <TooltipTrigger asChild>
          <div
            onClick={(e) => {
              e.currentTarget.blur();
              setOpen(true);
            }}
            className={dropdownMenuItemVariants()}
          >
            <SearchIcon />
            {t('button.search')}
          </div>
        </TooltipTrigger>
        <TooltipContent side='right'>
          <div className={'flex flex-col gap-1'}>
            <span>{t('search.sidebarSearchIcon')}</span>
            <div className={'text-text-secondary'}>{createHotKeyLabel(HOT_KEY_NAME.SEARCH)}</div>
          </div>
        </TooltipContent>
      </Tooltip>

      <Dialog
        disableRestoreFocus={true}
        open={open}
        onClose={handleClose}
        classes={{
          container: 'items-start max-md:mt-auto max-md:items-center mt-[10%]',
          paper: 'overflow-hidden min-w-[600px] w-[600px] max-w-[70vw]',
        }}
      >
        <div className={'flex w-full gap-2 border-b border-line-default p-4'}>
          <div className={'flex w-full items-center gap-4'}>
            <SearchIcon className={'mr-[1px] h-5 w-5 opacity-60'} />

            <InputBase
              value={searchValue}
              onChange={(e) => setSearchValue(e.target.value)}
              autoFocus={true}
              className={'flex-1'}
              fullWidth={true}
              placeholder={t('searchLabel')}
            />
            <span
              style={{
                visibility: searchValue ? 'visible' : 'hidden',
              }}
              className={'cursor-pointer rounded-full bg-fill-content-hover p-0.5 opacity-60 hover:opacity-100'}
              onMouseDown={(e) => e.preventDefault()}
              onClick={(e) => {
                e.preventDefault();
                setSearchValue('');
              }}
            >
              <CloseIcon className={'h-3 w-3'} />
            </span>
          </div>
        </div>
        {!searchValue ? (
          <RecentViews loading={loadingRecentViews} recentViews={recentViews} onClose={handleClose} />
        ) : (
          <BestMatch askingAI={askingAI} searchValue={searchValue} onAskAI={handleAskAI} onClose={handleClose} />
        )}
      </Dialog>
    </>
  );
}

export default Search;
