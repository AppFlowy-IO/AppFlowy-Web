import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { WorkspaceService } from '@/application/services/domains';
import { SubscriptionPlan, Workspace } from '@/application/types';
import { ReactComponent as ChevronDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as TipIcon } from '@/assets/icons/help.svg';
import { ReactComponent as AddIcon } from '@/assets/icons/plus.svg';
import { ReactComponent as ImportIcon } from '@/assets/icons/save_as.svg';
import { ReactComponent as SettingsIcon } from '@/assets/icons/settings.svg';
import { ReactComponent as UpgradeIcon } from '@/assets/icons/upgrade.svg';
import Import from '@/components/_shared/more-actions/importer/Import';
import { notify } from '@/components/_shared/notify';
import {
  useAppOperations,
  useCurrentWorkspaceId,
  useGetSubscriptions,
  useIsOfficialHosted,
  useRefreshUserWorkspaceInfo,
  useUserWorkspaceInfo,
} from '@/components/app/app.hooks';
import { useSubscriptionPlan } from '@/components/app/hooks/useSubscriptionPlan';
import { useWorkspaceCreationFlow } from '@/components/app/hooks/useWorkspaceCreationAttempt';
import { useWorkspaceCreationCapability } from '@/components/app/hooks/useWorkspaceCreationCapability';
import { SettingsDialog } from '@/components/app/settings';
import { CreateWorkspaceDialog } from '@/components/app/workspaces/CreateWorkspaceDialog';
import CurrentWorkspace from '@/components/app/workspaces/CurrentWorkspace';
import DeleteWorkspace from '@/components/app/workspaces/DeleteWorkspace';
import EditWorkspace from '@/components/app/workspaces/EditWorkspace';
import LeaveWorkspace from '@/components/app/workspaces/LeaveWorkspace';
import { UnavailableMenuItem } from '@/components/app/workspaces/UnavailableMenuItem';
import { workspaceCreationBlockedReason } from '@/components/app/workspaces/WorkspaceCreationNotice';
import WorkspaceList from '@/components/app/workspaces/WorkspaceList';
import UpgradePlan from '@/components/billing/UpgradePlan';
import { useCurrentUser } from '@/components/main/app.hooks';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  dropdownMenuItemVariants,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { canManageWorkspaceBilling } from '@/utils/subscription';
import { openUrl } from '@/utils/url';

export function Workspaces() {
  const { t } = useTranslation();
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const refreshUserWorkspaceInfo = useRefreshUserWorkspaceInfo();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const currentUser = useCurrentUser();
  const isHosted = useIsOfficialHosted();
  const [openUpgradePlan, setOpenUpgradePlan] = useState(false);
  const [open, setOpen] = useState(false);
  const [hoveredHeader, setHoveredHeader] = useState<boolean>(false);
  const ref = useRef<HTMLDivElement | null>(null);
  const workspaceListScrollRef = useRef<HTMLDivElement | null>(null);
  const [changeLoading, setChangeLoading] = useState<string | null>(null);
  const { onChangeWorkspace: handleSelectedWorkspace } = useAppOperations();
  const [currentWorkspace, setCurrentWorkspace] = useState<Workspace | undefined>(undefined);
  const [openCreateWorkspace, setOpenCreateWorkspace] = useState(false);
  const [openRenameWorkspace, setOpenRenameWorkspace] = useState<Workspace | null>(null);
  const [openDeleteWorkspace, setOpenDeleteWorkspace] = useState<Workspace | null>(null);
  const [openLeaveWorkspace, setOpenLeaveWorkspace] = useState<Workspace | null>(null);
  const [openSettings, setOpenSettings] = useState(false);
  const creation = useWorkspaceCreationCapability();
  const openCreatedWorkspace = useCallback(
    async (workspaceId: string) => {
      await handleSelectedWorkspace?.(workspaceId);
    },
    [handleSelectedWorkspace]
  );
  const creationFlow = useWorkspaceCreationFlow(creation, openCreatedWorkspace);
  // A saved request can always be finished or discarded, even after access changes.
  const canOpenCreate = creation.canCreate || Boolean(creationFlow.draft) || creationFlow.unreadable;
  const creationBlockedKey = workspaceCreationBlockedReason(creation);
  const creationBlockedReason = creationBlockedKey && t(creationBlockedKey);

  const canManageBilling =
    currentWorkspace?.id === currentWorkspaceId &&
    canManageWorkspaceBilling(currentWorkspace, currentUser?.uid, isHosted);

  useEffect(() => {
    setCurrentWorkspace(userWorkspaceInfo?.workspaces.find((workspace) => workspace.id === currentWorkspaceId));
  }, [currentWorkspaceId, userWorkspaceInfo]);

  const handleChange = useCallback(
    async (selectedId: string) => {
      setChangeLoading(selectedId);
      try {
        await handleSelectedWorkspace?.(selectedId);
        setOpen(false);
      } catch (e) {
        notify.error(t('workspace.openFailed'));
      }

      setChangeLoading(null);
    },
    [handleSelectedWorkspace, t]
  );
  const [, setSearchParams] = useSearchParams();

  const handleOpenImport = useCallback(
    (source: 'notion' | 'appflowy' | 'confluence') => {
      if (!creation.canCreate) return;
      setSearchParams((prev) => {
        prev.set('action', 'import');
        prev.set('source', source);
        return prev;
      });
    },
    [setSearchParams, creation.canCreate]
  );

  const handleUpdateWorkspace = useCallback(
    async (name: string) => {
      if (!openRenameWorkspace) return;
      await WorkspaceService.update(openRenameWorkspace.id, {
        workspace_name: name,
      });
      if (openRenameWorkspace.id === currentWorkspaceId) {
        setCurrentWorkspace((prev) => {
          if (!prev) return prev;
          return { ...prev, name };
        });
      }

      // The optimistic patch above only covers the current workspace's local
      // state — refresh the shared workspace list so every consumer (header,
      // mobile switcher, members panel) drops the old name.
      void refreshUserWorkspaceInfo?.();

      setOpenRenameWorkspace(null);
    },
    [openRenameWorkspace, currentWorkspaceId, refreshUserWorkspaceInfo]
  );

  return (
    <>
      <div className='mx-1 flex-1 overflow-hidden' data-testid='sidebar-page-header'>
        <DropdownMenu modal={false} open={open} onOpenChange={setOpen}>
          <DropdownMenuTrigger asChild>
            <div
              ref={ref}
              data-testid='workspace-dropdown-trigger'
              onMouseLeave={() => setHoveredHeader(false)}
              onMouseEnter={() => setHoveredHeader(true)}
              className={dropdownMenuItemVariants({ variant: 'default', className: 'w-full overflow-hidden' })}
            >
              <CurrentWorkspace
                userWorkspaceInfo={userWorkspaceInfo}
                selectedWorkspace={currentWorkspace}
                onChangeWorkspace={handleChange}
                avatarSize='sm'
                changeLoading={changeLoading ? true : false}
              />

              <div
                className='ml-auto transition-opacity duration-300'
                style={{
                  opacity: hoveredHeader ? 1 : 0,
                }}
              >
                <ChevronDownIcon className='h-5 w-5' />
              </div>
            </div>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            data-testid='workspace-dropdown-content'
            className='min-w-[300px] max-w-[300px] overflow-hidden'
          >
            <DropdownMenuLabel className='w-full overflow-hidden'>
              <span className='truncate'>{currentUser?.email}</span>
            </DropdownMenuLabel>
            <DropdownMenuGroup>
              <div
                ref={workspaceListScrollRef}
                data-testid='workspace-list'
                className={'appflowy-scroller max-h-[200px] flex-1 overflow-y-auto overflow-x-hidden'}
              >
                <WorkspaceList
                  defaultWorkspaces={userWorkspaceInfo?.workspaces}
                  currentWorkspaceId={currentWorkspaceId}
                  onChange={handleChange}
                  changeLoading={changeLoading || undefined}
                  onUpdate={setOpenRenameWorkspace}
                  onDelete={setOpenDeleteWorkspace}
                  onLeave={setOpenLeaveWorkspace}
                  autoScrollContainerRef={workspaceListScrollRef}
                />
              </div>
            </DropdownMenuGroup>
            {creationBlockedReason && !canOpenCreate ? (
              <UnavailableMenuItem
                testId='create-workspace'
                label={t('workspace.create')}
                reason={creationBlockedReason}
                icon={
                  <div className={'flex h-5 w-5 items-center justify-center rounded-100 border border-border-primary'}>
                    <AddIcon className={'!h-4 !w-4'} />
                  </div>
                }
              />
            ) : (
              <DropdownMenuItem data-testid='create-workspace' onSelect={() => setOpenCreateWorkspace(true)}>
                <div className={'flex h-5 w-5 items-center justify-center rounded-100 border border-border-primary'}>
                  <AddIcon className={'!h-4 !w-4'} />
                </div>
                {t('workspace.create')}
              </DropdownMenuItem>
            )}
            {creation.status === 'error' && !canOpenCreate && (
              <DropdownMenuItem
                data-testid='workspace-creation-check-again'
                disabled={creation.checking}
                onSelect={(event) => {
                  // Keep the menu open so the result replaces the reason in place.
                  event.preventDefault();
                  void creation.refresh();
                }}
              >
                <div className={'h-5 w-5'} />
                {t('workspaceCreation.checkAgain')}
              </DropdownMenuItem>
            )}
            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              {creationBlockedReason ? (
                <UnavailableMenuItem
                  testId='import-workspace-trigger'
                  label={t('workspaceCreation.importWorkspace')}
                  reason={creationBlockedReason}
                  icon={<ImportIcon />}
                />
              ) : (
                <DropdownMenuSub>
                  <DropdownMenuSubTrigger data-testid='import-workspace-trigger'>
                    <ImportIcon />
                    <div className={'flex-1 text-left'}>{t('workspaceCreation.importWorkspace')}</div>
                  </DropdownMenuSubTrigger>
                  <DropdownMenuSubContent>
                    <DropdownMenuItem data-testid='import-from-appflowy' onSelect={() => handleOpenImport('appflowy')}>
                      <div className={'flex-1 text-left'}>{t('web.importFromAppFlowy')}</div>
                    </DropdownMenuItem>
                    <DropdownMenuItem data-testid='import-from-notion' onSelect={() => handleOpenImport('notion')}>
                      <div className={'flex-1 text-left'}>{t('web.importFromNotion')}</div>
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <span
                            onClick={(e) => {
                              e.stopPropagation();
                              void openUrl('https://docs.appflowy.io/docs/guides/import-from-notion', '_blank');
                            }}
                            className={'ml-auto cursor-pointer text-icon-secondary'}
                          >
                            <TipIcon />
                          </span>
                        </TooltipTrigger>
                        <TooltipContent>{t('workspace.learnMore')}</TooltipContent>
                      </Tooltip>
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      data-testid='import-from-confluence'
                      onSelect={() => handleOpenImport('confluence')}
                    >
                      <div className={'flex-1 text-left'}>{t('web.importFromConfluence')}</div>
                    </DropdownMenuItem>
                  </DropdownMenuSubContent>
                </DropdownMenuSub>
              )}
            </DropdownMenuGroup>

            <DropdownMenuSeparator />
            <DropdownMenuGroup>
              <DropdownMenuItem data-testid='settings-button' onSelect={() => setOpenSettings(true)}>
                <SettingsIcon />
                <div className={'flex-1 text-left'}>{t('web.settings')}</div>
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {open && canManageBilling && (
              <WorkspaceUpgradeMenuItem
                onSelect={() => {
                  setOpenUpgradePlan(true);
                  setOpen(false);
                }}
              />
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {canManageBilling && (
        <UpgradePlan
          onOpen={() => {
            setOpenUpgradePlan(true);
          }}
          open={openUpgradePlan}
          onClose={() => setOpenUpgradePlan(false)}
        />
      )}

      <Import />
      {openCreateWorkspace && (
        <CreateWorkspaceDialog
          open={openCreateWorkspace}
          onOpenChange={setOpenCreateWorkspace}
          creation={creation}
          flow={creationFlow}
          defaultName={currentUser?.name ? `${currentUser.name}'s Workspace` : undefined}
          onDiscarded={() => void refreshUserWorkspaceInfo?.()}
        />
      )}

      {openRenameWorkspace && (
        <EditWorkspace
          open={Boolean(openRenameWorkspace)}
          openOnChange={() => setOpenRenameWorkspace(null)}
          onOk={handleUpdateWorkspace}
          okText={t('button.rename')}
          defaultName={openRenameWorkspace.name}
          title={t('workspace.rename')}
        />
      )}

      {openDeleteWorkspace && (
        <DeleteWorkspace
          workspaceId={openDeleteWorkspace.id}
          name={openDeleteWorkspace.name}
          open={Boolean(openDeleteWorkspace)}
          openOnChange={() => setOpenDeleteWorkspace(null)}
        />
      )}

      {openLeaveWorkspace && (
        <LeaveWorkspace
          workspaceName={openLeaveWorkspace.name}
          workspaceId={openLeaveWorkspace.id}
          open={Boolean(openLeaveWorkspace)}
          openOnChange={() => setOpenLeaveWorkspace(null)}
        />
      )}

      <SettingsDialog
        open={openSettings}
        onClose={() => setOpenSettings(false)}
        onRequestOpen={() => setOpenSettings(true)}
      />
    </>
  );
}

// Mount on each menu opening to refresh the plan after returning from checkout.
function WorkspaceUpgradeMenuItem({ onSelect }: { onSelect: () => void }) {
  const { t } = useTranslation();
  const getSubscriptions = useGetSubscriptions();
  const { activeSubscriptionPlan } = useSubscriptionPlan(getSubscriptions);

  if (!getSubscriptions || activeSubscriptionPlan !== SubscriptionPlan.Free) return null;

  return (
    <DropdownMenuGroup>
      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onSelect}>
        <UpgradeIcon />
        {t('subscribe.changePlan')}
      </DropdownMenuItem>
    </DropdownMenuGroup>
  );
}

export default Workspaces;
