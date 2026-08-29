import { ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { createDatabaseGalleryPageViaGrid } from '@/application/database-yjs/gallery-layout';
import { createDatabaseListPageViaGrid } from '@/application/database-yjs/list-layout';
import { View, ViewLayout } from '@/application/types';
import { ReactComponent as UploadIcon } from '@/assets/icons/upload.svg';
import { ViewIcon } from '@/components/_shared/view-icon';
import { buildInitialAIChatSettings } from '@/components/ai-chat/chat-settings';
import { isSpaceView } from '@/components/ai-chat/rag-scope';
import {
  useAIEnabled,
  useAppOperations,
  useCurrentWorkspaceId,
  useOpenPageModal,
  useScheduleDeferredCleanup,
  useToView,
} from '@/components/app/app.hooks';
import { useCanAuthorFormView } from '@/components/database/form/useCanAuthorFormView';
import { DropdownMenuGroup, DropdownMenuItem } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

function AddPageActions({
  view,
  onClose,
  onImportClick,
}: {
  view: View;
  onClose?: () => void;
  onImportClick?: (view: View) => void;
}) {
  const { t } = useTranslation();
  const { addPage, bindViewSync, createDatabaseView, deletePage, deleteTrash, loadView, loadViewMeta, updatePage } =
    useAppOperations();
  const openPageModal = useOpenPageModal();
  const scheduleDeferredCleanup = useScheduleDeferredCleanup();
  const toView = useToView();
  const aiEnabled = useAIEnabled();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const lastChildViewId = view.children?.[view.children.length - 1]?.view_id;
  const { canAuthor, ensureCanAuthor } = useCanAuthorFormView();
  const [, setSearch] = useSearchParams();
  const mountedRef = useRef(true);
  const pendingKeptOpenSelectionRef = useRef(false);
  const [isKeptOpenSelectionPending, setIsKeptOpenSelectionPending] = useState(false);

  useEffect(() => {
    mountedRef.current = true;

    return () => {
      mountedRef.current = false;
    };
  }, []);
  const openUpgradePlan = useCallback(() => {
    setSearch((prev) => {
      prev.set('action', 'change_plan');
      return prev;
    });
  }, [setSearch]);

  const handleAddPage = useCallback(
    async (layout: ViewLayout, name?: string) => {
      if (!addPage) return;
      if (layout === ViewLayout.AIChat && !aiEnabled) return;
      if (layout === ViewLayout.Form) {
        const allowed = canAuthor ?? (await ensureCanAuthor());

        // A cold entitlement check keeps this menu open. If the user dismisses
        // it while that request is pending, cancel this menu instance quietly;
        // its hook intentionally rejects results after unmount.
        if (!mountedRef.current) return;

        if (allowed === null) {
          toast.error('Could not verify your workspace plan. Please try again.');
          return;
        }

        if (!allowed) {
          openUpgradePlan();
          return;
        }
      }

      const loadingToastId = toast.loading(t('document.creating'));

      try {
        // Append after the last child so the new page appears at the bottom.
        // When prev_view_id is omitted the backend prepends (inserts at index 0).
        const response =
          layout === ViewLayout.List
            ? await (() => {
                if (!bindViewSync || !createDatabaseView || !deletePage || !deleteTrash || !scheduleDeferredCleanup) {
                  throw new Error('List creation is not available right now');
                }

                return createDatabaseListPageViaGrid({
                  parentViewId: view.view_id,
                  name,
                  prevViewId: lastChildViewId,
                  standalone: true,
                  addPage,
                  createDatabaseView,
                  deletePage,
                  deleteTrash,
                  loadViewMeta,
                  loadView,
                  bindViewSync,
                  scheduleDeferredCleanup,
                  updatePage,
                });
              })()
            : layout === ViewLayout.Gallery
            ? await (() => {
                if (!bindViewSync || !createDatabaseView || !deletePage || !deleteTrash || !scheduleDeferredCleanup) {
                  throw new Error('Gallery creation is not available right now');
                }

                return createDatabaseGalleryPageViaGrid({
                  parentViewId: view.view_id,
                  name,
                  prevViewId: lastChildViewId,
                  standalone: true,
                  addPage,
                  createDatabaseView,
                  deletePage,
                  deleteTrash,
                  loadViewMeta,
                  loadView,
                  bindViewSync,
                  scheduleDeferredCleanup,
                  updatePage,
                });
              })()
            : await addPage(view.view_id, { layout, name, prev_view_id: lastChildViewId });

        if (layout === ViewLayout.AIChat && currentWorkspaceId) {
          try {
            const [{ ChatRequest }, { getAxiosInstance }] = await Promise.all([
              import('@/components/chat/request'),
              import('@/application/services/js-services/http'),
            ]);
            const axiosInstance = getAxiosInstance();

            if (!axiosInstance) {
              throw new Error('Missing axios instance');
            }

            const request = new ChatRequest(currentWorkspaceId, response.view_id, axiosInstance);
            const scopedParent = isSpaceView(view) ? view : await request.getView(view.view_id);
            const initialSettings = buildInitialAIChatSettings({ parent: scopedParent });

            if (Object.keys(initialSettings).length > 0) {
              await request.updateChatSettings(initialSettings);
            }
          } catch {
            toast.error(
              t('search.updateAIChatSettingsFailed', {
                defaultValue: 'AI chat was created, but the context could not be attached',
              })
            );
          }
        }

        if (layout === ViewLayout.Document) {
          void openPageModal?.(response.view_id);
        } else {
          void toView(response.view_id);
        }

        toast.dismiss(loadingToastId);
        // eslint-disable-next-line
      } catch (e: any) {
        toast.dismiss(loadingToastId);
        toast.error(e.message);
      }
    },
    [
      addPage,
      aiEnabled,
      bindViewSync,
      canAuthor,
      createDatabaseView,
      currentWorkspaceId,
      deletePage,
      deleteTrash,
      lastChildViewId,
      loadView,
      loadViewMeta,
      openPageModal,
      openUpgradePlan,
      scheduleDeferredCleanup,
      t,
      toView,
      updatePage,
      view,
      ensureCanAuthor,
    ]
  );

  const actions: {
    label: string;
    icon: ReactNode;
    testId?: string;
    disabled?: boolean;
    tooltip?: string;
    guardWhilePending?: boolean;
    keepOpenUntilSettled?: boolean;
    onSelect: () => void | Promise<void>;
  }[] = useMemo(
    () => [
      {
        label: t('document.menuName'),
        icon: <ViewIcon layout={ViewLayout.Document} size={'small'} />,
        testId: 'add-document-button',
        onSelect: () => {
          void handleAddPage(ViewLayout.Document, t('menuAppHeader.defaultNewPageName'));
        },
      },
      {
        label: t('grid.menuName'),
        icon: <ViewIcon layout={ViewLayout.Grid} size={'small'} />,
        testId: 'add-grid-button',
        onSelect: () => {
          void handleAddPage(ViewLayout.Grid, t('document.plugins.database.newDatabase'));
        },
      },
      {
        label: t('board.menuName'),
        icon: <ViewIcon layout={ViewLayout.Board} size={'small'} />,
        onSelect: () => {
          void handleAddPage(ViewLayout.Board, t('document.plugins.database.newDatabase'));
        },
      },
      {
        label: t('calendar.menuName'),
        icon: <ViewIcon layout={ViewLayout.Calendar} size={'medium'} />,
        onSelect: () => {
          void handleAddPage(ViewLayout.Calendar, t('document.plugins.database.newDatabase'));
        },
      },
      ...(aiEnabled
        ? [
            {
              label: t('chat.newChat'),
              icon: <ViewIcon layout={ViewLayout.AIChat} size={'small'} />,
              testId: 'add-ai-chat-button',
              onSelect: () => {
                void handleAddPage(ViewLayout.AIChat, t('menuAppHeader.defaultNewPageName'));
              },
            },
          ]
        : []),
      {
        label: t('chart.menuName'),
        icon: <ViewIcon layout={ViewLayout.Chart} size={'small'} />,
        testId: 'add-chart-button',
        onSelect: () => {
          void handleAddPage(ViewLayout.Chart, t('document.plugins.database.newDatabase'));
        },
      },
      {
        label: t('form.menuName'),
        icon: <ViewIcon layout={ViewLayout.Form} size={'small'} />,
        testId: 'add-form-button',
        // Radix normally closes and unmounts the menu on selection. Keep the
        // entitlement hook alive only for a cold plan check; once it settles,
        // close explicitly. Known allow/deny states still close immediately.
        guardWhilePending: true,
        keepOpenUntilSettled: canAuthor === null,
        onSelect: () => handleAddPage(ViewLayout.Form, t('document.plugins.database.newDatabase')),
      },
      {
        label: t('list.menuName'),
        icon: <ViewIcon layout={ViewLayout.List} size={'small'} />,
        testId: 'add-list-button',
        onSelect: () => {
          void handleAddPage(ViewLayout.List, t('document.plugins.database.newDatabase'));
        },
      },
      {
        label: t('gallery.menuName'),
        icon: <ViewIcon layout={ViewLayout.Gallery} size={'small'} />,
        testId: 'add-gallery-button',
        onSelect: () => {
          void handleAddPage(ViewLayout.Gallery, t('document.plugins.database.newDatabase'));
        },
      },
      {
        label: t('moreAction.import'),
        icon: <UploadIcon className='h-5 w-5 text-icon-primary' />,
        testId: 'add-import-button',
        onSelect: () => {
          onImportClick?.(view);
        },
      },
    ],
    [aiEnabled, canAuthor, handleAddPage, t, onImportClick, view]
  );

  return (
    <DropdownMenuGroup>
      {actions.map((action) =>
        action.disabled && action.tooltip ? (
          <Tooltip key={action.label}>
            <TooltipTrigger asChild>
              <div>
                <DropdownMenuItem disabled>
                  {action.icon}
                  {action.label}
                </DropdownMenuItem>
              </div>
            </TooltipTrigger>
            <TooltipContent>{action.tooltip}</TooltipContent>
          </Tooltip>
        ) : (
          <DropdownMenuItem
            key={action.label}
            data-testid={action.testId}
            disabled={action.disabled || isKeptOpenSelectionPending}
            onSelect={(event) => {
              if (action.guardWhilePending && pendingKeptOpenSelectionRef.current) {
                event.preventDefault();
                return;
              }

              if (!action.keepOpenUntilSettled) {
                void action.onSelect();
                return;
              }

              event.preventDefault();
              if (action.guardWhilePending) {
                pendingKeptOpenSelectionRef.current = true;
                setIsKeptOpenSelectionPending(true);
              }

              void Promise.resolve()
                .then(action.onSelect)
                .finally(() => {
                  pendingKeptOpenSelectionRef.current = false;
                  if (action.guardWhilePending && mountedRef.current) {
                    setIsKeptOpenSelectionPending(false);
                  }

                  if (mountedRef.current) {
                    onClose?.();
                  }
                });
            }}
          >
            {action.icon}
            {action.label}
          </DropdownMenuItem>
        )
      )}
    </DropdownMenuGroup>
  );
}

export default AddPageActions;
