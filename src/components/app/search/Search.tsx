import { Dialog, InputBase } from '@mui/material';
import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ERROR_CODE } from '@/application/constants';
import { AccessService, WorkspaceService } from '@/application/services/domains';
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
import { isCollabObjectPermissionForTarget, resolvePermissionProbeTarget } from '@/components/app/layers/permissionProbe';
import RecentViews from '@/components/app/search/RecentViews';
import SearchStatusNotice from '@/components/app/search/SearchStatusNotice';
import { useSearchAccessScope } from '@/components/app/search/useSearchAccessScope';
import { useSearchRecentViews } from '@/components/app/search/useSearchRecentViews';
import ViewList from '@/components/app/search/ViewList';
import { canUseChildViewCreationActions } from '@/components/app/view-actions/viewActionPermission';
import { findAncestors } from '@/components/chat/lib/views';
import type { View as ChatView } from '@/components/chat/types';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { getAPIErrorCode } from '@/utils/errors';
import { createHotkey, createHotKeyLabel, HOT_KEY_NAME } from '@/utils/hotkeys';

const BestMatch = lazy(() => import('@/components/app/search/BestMatch'));

function getFallbackAIChatParent(outline: View[] | undefined) {
  if (!outline?.length) return;

  return outline.find(isSpaceView) || outline[0];
}

function getErrorMessage(error: unknown) {
  if (error instanceof Error) return error.message;
  if (typeof error === 'string') return error;
  return 'Something went wrong';
}

function isPermissionDenied(error: unknown) {
  const status = (error as { httpStatus?: unknown; response?: { status?: unknown } } | null) ?? undefined;

  return (
    getAPIErrorCode(error) === ERROR_CODE.NOT_HAS_PERMISSION ||
    status?.httpStatus === 403 ||
    status?.response?.status === 403
  );
}

/**
 * Applies the rule every direct-child creation uses: Write on the destination, plus the space's
 * "who can add pages" policy when the destination is a space. Only a definite answer blocks; older
 * servers without these routes and transient probe failures leave the decision to the server.
 */
async function canAddChildPage(workspaceId: string, parent: ChatView) {
  // The chat request types the same folder-view payload more narrowly (no `is_published`).
  const target = resolvePermissionProbeTarget(parent.view_id, { ...parent, is_published: false } as unknown as View);
  const space = isSpaceView(parent);
  const [object, sidebar] = await Promise.allSettled([
    AccessService.getObjectPermission(workspaceId, target.collabObjectId, target.collabType),
    space ? WorkspaceService.getSpacePermission(workspaceId, parent.view_id) : Promise.resolve(undefined),
  ]);

  if (
    (object.status === 'rejected' && isPermissionDenied(object.reason)) ||
    (sidebar.status === 'rejected' && isPermissionDenied(sidebar.reason))
  ) {
    return false;
  }

  const objectPermission =
    object.status === 'fulfilled' && isCollabObjectPermissionForTarget(object.value, target) ? object.value : undefined;
  const spacePermission = sidebar.status === 'fulfilled' ? sidebar.value : undefined;

  return canUseChildViewCreationActions({
    objectPermission: objectPermission ?? { can_read: true, can_write: true, can_share: false },
    spaceSidebar: space ? { canEdit: spacePermission ? spacePermission.can_edit_sidebar === true : true } : undefined,
  });
}

/** `committed` once the create request is sent: from then on the attempt finishes its own page. */
interface AskAIAttempt {
  committed: boolean;
}

export function Search() {
  const [open, setOpen] = useState<boolean>(false);
  const dialogGeneration = useRef(0);
  const { t } = useTranslation();
  const [searchValue, setSearchValue] = useState<string>('');
  const askingRef = useRef<AskAIAttempt>();
  const [asking, setAsking] = useState<AskAIAttempt>();
  const outline = useAppOutline();
  const currentViewId = useAppViewId();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const { scope, isCurrent, isSessionCurrent, refreshKey, online } = useSearchAccessScope(currentWorkspaceId);
  // Busy for the attempt's whole life, so a permission hint cannot re-enable the same request.
  const askingAI = asking !== undefined;
  const aiEnabled = useAIEnabled();
  const { addPage } = useAppOperations();
  const toView = useToView();
  const finishAsking = useCallback((attempt?: AskAIAttempt) => {
    if (attempt && askingRef.current !== attempt) return;
    askingRef.current = undefined;
    setAsking(undefined);
  }, []);
  const handleClose = useCallback(() => {
    dialogGeneration.current += 1;
    // Closing cancels an attempt that has not created anything yet; a created chat still finishes.
    if (askingRef.current && !askingRef.current.committed) finishAsking();
    setOpen(false);
    setSearchValue('');
  }, [finishAsking]);

  const handleAskAI = useCallback(
    async (query: string, sources?: AIChatRagSource[]) => {
      if (askingRef.current || !isCurrent() || !aiEnabled || !addPage || !currentWorkspaceId) return;

      const generation = dialogGeneration.current;
      const isDialogCurrent = () => dialogGeneration.current === generation;
      // Until the create request is sent, closing the dialog or any permission or session change
      // cancels: nothing has been created yet, and the prepared parent/context may be stale.
      const canPrepare = () => isDialogCurrent() && isCurrent();
      const cancelPreparation = () => {
        if (isDialogCurrent() && isSessionCurrent()) notify.default(t('search.aiChatPermissionsChanged'));
      };

      const attempt: AskAIAttempt = { committed: false };

      askingRef.current = attempt;
      setAsking(attempt);
      try {
        const [{ ChatRequest }, { getAxiosInstance }] = await Promise.all([
          import('@/components/chat/request'),
          import('@/application/services/js-services/http'),
        ]);
        const axiosInstance = getAxiosInstance();

        if (!canPrepare()) return cancelPreparation();

        if (!axiosInstance) {
          throw new Error('Missing axios instance');
        }

        const scopeRequest = new ChatRequest(currentWorkspaceId, currentViewId, axiosInstance);
        let parentViewId: string | undefined;

        if (currentViewId) {
          const navigation = await scopeRequest.getViewNavigation(currentViewId);

          if (!canPrepare()) return cancelPreparation();
          const currentPath = findAncestors([navigation], currentViewId);

          // Shared/private navigation can intentionally omit inaccessible space
          // ancestors. In that case the visible navigation root is the only
          // authoritative scope we can attach the new chat beneath.
          parentViewId = currentPath?.find(isSpaceView)?.view_id || currentPath?.[0]?.view_id;
        } else {
          parentViewId = getFallbackAIChatParent(outline)?.view_id;
        }

        if (!parentViewId) {
          notify.error(t('search.createAIChatFailed'));
          return;
        }

        const scopedParent = await scopeRequest.fetchCompleteView(parentViewId, true);

        if (!canPrepare()) return cancelPreparation();
        const parentName = scopedParent.name?.trim() || t('menuAppHeader.defaultNewPageName');
        const allowed = await canAddChildPage(currentWorkspaceId, scopedParent);

        if (!canPrepare()) return cancelPreparation();
        if (!allowed) {
          notify.error(t('search.aiChatParentDenied', { name: parentName }));
          return;
        }

        attempt.committed = true;
        let created: { view_id: string };

        try {
          created = await addPage(scopedParent.view_id, {
            layout: ViewLayout.AIChat,
            name: query || t('chat.newChat', { defaultValue: 'New chat' }),
            prev_view_id: scopedParent.children?.[scopedParent.children.length - 1]?.view_id,
          });
        } catch (error) {
          if (isSessionCurrent()) {
            notify.error(
              isPermissionDenied(error) ? t('search.aiChatParentDenied', { name: parentName }) : getErrorMessage(error)
            );
          }

          return;
        }

        // The chat exists now and is never abandoned silently. Only another session, account,
        // workspace or server stops here: nothing may be shown or opened in that context.
        if (!isSessionCurrent()) return;
        let settingsError: unknown;

        try {
          // Context chosen under an older permission scope is re-read before it is attached;
          // sources outside the fresh, permission-filtered parent tree are dropped.
          const parent = isCurrent() ? scopedParent : await scopeRequest.fetchCompleteView(parentViewId, true);
          const initialSettings = buildInitialAIChatSettings({ parent, query, sources });

          if (isSessionCurrent() && Object.keys(initialSettings).length > 0) {
            await new ChatRequest(currentWorkspaceId, created.view_id, axiosInstance).updateChatSettings(
              initialSettings
            );
          }
        } catch (error) {
          settingsError = error;
        }

        if (!isSessionCurrent()) return;
        if (settingsError) {
          notify.error(t('search.updateAIChatSettingsFailed'));
        }

        if (isDialogCurrent()) {
          await toView(created.view_id);
          if (isDialogCurrent()) handleClose();
          return;
        }

        // The dialog was closed while the chat was being created: stay put, but point to it.
        const chatId = created.view_id;

        toast.success(t('search.aiChatCreated'), {
          action: { label: t('search.openAIChat'), onClick: () => void toView(chatId) },
        });
      } catch (error) {
        if (attempt.committed ? isSessionCurrent() : canPrepare()) notify.error(getErrorMessage(error));
      } finally {
        finishAsking(attempt);
      }
    },
    [
      addPage,
      aiEnabled,
      currentViewId,
      currentWorkspaceId,
      finishAsking,
      handleClose,
      isCurrent,
      isSessionCurrent,
      outline,
      t,
      toView,
    ]
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

  const { loadRecentViews } = useAppRecent();
  const recent = useSearchRecentViews({
    open,
    visible: open && !searchValue,
    scope,
    isCurrent,
    load: loadRecentViews,
    refreshKey,
    online,
  });
  let recentContent;

  if (recent.status === 'error') {
    recentContent = (
      <SearchStatusNotice
        title={t('recentPages')}
        message={t('search.recentPagesFailed')}
        actionLabel={t('button.tryAgain')}
        onAction={recent.retry}
      />
    );
  } else if (recent.status === 'offline') {
    recentContent = <SearchStatusNotice title={t('recentPages')} message={t('search.offlineRecentPages')} />;
  } else if (recent.status === 'ready' && recent.views.length === 0) {
    recentContent = <SearchStatusNotice title={t('recentPages')} message={t('search.noRecentPages')} />;
  } else {
    recentContent = (
      <RecentViews
        loading={recent.status === 'loading' || recent.revalidating}
        recentViews={recent.views}
        onClose={handleClose}
      />
    );
  }

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
          recentContent
        ) : (
          <Suspense fallback={<ViewList loading title={t('commandPalette.bestMatches')} onClose={handleClose} />}>
            <BestMatch askingAI={askingAI} searchValue={searchValue} onAskAI={handleAskAI} onClose={handleClose} />
          </Suspense>
        )}
      </Dialog>
    </>
  );
}

export default Search;
