import Dialog from '@mui/material/Dialog';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { Role, SettingMenuItem } from '@/application/types';
import { isSameUserUid } from '@/application/user-uid';
import { useCurrentWorkspaceId, useIsOfficialHosted, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { AccountAppPanel } from '@/components/app/settings/AccountAppPanel';
import { ManageDataPanel } from '@/components/app/settings/ManageDataPanel';
import { MembersPanel } from '@/components/app/settings/MembersPanel';
import { ProfilePanel } from '@/components/app/settings/ProfilePanel';
import SettingMenu from '@/components/app/settings/SettingMenu';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Progress } from '@/components/ui/progress';

const ConnectionsPanel = lazy(() =>
  import('@/components/app/settings/ConnectionsPanel').then((module) => ({ default: module.ConnectionsPanel }))
);
const PlanPanel = lazy(() =>
  import('@/components/app/settings/PlanPanel').then((module) => ({ default: module.PlanPanel }))
);
const BillingPanel = lazy(() =>
  import('@/components/app/settings/BillingPanel').then((module) => ({ default: module.BillingPanel }))
);

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onRequestOpen?: () => void;
}

export function SettingsDialog({ open, onClose, onRequestOpen }: SettingsDialogProps) {
  const { t } = useTranslation();
  const [search, setSearch] = useSearchParams();
  const workspaceId = useCurrentWorkspaceId();
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentUser = useCurrentUserOptional();
  const isOfficialHosted = useIsOfficialHosted();
  const [selectedItem, setSelectedItem] = useState<SettingMenuItem>(SettingMenuItem.ACCOUNT);

  const currentWorkspace = useMemo(
    () => userWorkspaceInfo?.workspaces.find((workspace) => workspace.id === workspaceId),
    [userWorkspaceInfo?.workspaces, workspaceId]
  );
  const isOwner =
    currentWorkspace?.role === Role.Owner || isSameUserUid(currentWorkspace?.owner?.uid, currentUser?.uid);
  // Billing exists only on the official cloud, and only the owner can change a workspace's plan.
  const showBilling = isOfficialHosted && isOwner;

  useEffect(() => {
    if (!showBilling && (selectedItem === SettingMenuItem.PLAN || selectedItem === SettingMenuItem.BILLING)) {
      setSelectedItem(SettingMenuItem.ACCOUNT);
    }
  }, [selectedItem, showBilling]);

  useEffect(() => {
    const item = search.get('setting') as SettingMenuItem | null;

    if (item) {
      setSelectedItem(item);
      onRequestOpen?.();
      setSearch((prev) => {
        prev.delete('setting');
        return prev;
      });
    }
  }, [search, setSearch, onRequestOpen]);

  const handleImport = useCallback(() => {
    // Reuse the workspace importer after closing Settings so only one dialog owns focus.
    onClose();
    setSearch((prev) => {
      const next = new URLSearchParams(prev);

      next.set('action', 'import');
      next.set('source', 'appflowy');
      return next;
    });
  }, [onClose, setSearch]);

  return (
    <Dialog
      classes={{
        paper: 'w-[1120px] h-[760px] max-w-[96vw] max-h-[92vh] flex flex-row overflow-hidden bg-surface-primary',
      }}
      open={open}
      onClose={onClose}
      PaperProps={{ 'data-testid': 'settings-dialog' }}
    >
      <SettingMenu onSelectItem={setSelectedItem} selectedItem={selectedItem} showBilling={showBilling} />
      <div className='flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden'>
        {selectedItem === SettingMenuItem.ACCOUNT && <AccountAppPanel />}
        {selectedItem === SettingMenuItem.PROFILE && <ProfilePanel />}
        {selectedItem === SettingMenuItem.MEMBERS && <MembersPanel />}
        {selectedItem === SettingMenuItem.MANAGE_DATA && <ManageDataPanel onImport={handleImport} />}
        {open && selectedItem === SettingMenuItem.CONNECTIONS && workspaceId && (
          <Suspense
            fallback={
              <div
                role='status'
                aria-label={t('settings.connections.loading')}
                className='flex h-full items-center justify-center'
              >
                <Progress variant='primary' />
              </div>
            }
          >
            <ConnectionsPanel key={workspaceId} workspaceId={workspaceId} />
          </Suspense>
        )}
        {open && showBilling && selectedItem === SettingMenuItem.PLAN && workspaceId && (
          <Suspense fallback={<PanelFallback label={t('settings.planPage.title')} />}>
            <PlanPanel key={workspaceId} workspaceId={workspaceId} />
          </Suspense>
        )}
        {open && showBilling && selectedItem === SettingMenuItem.BILLING && workspaceId && (
          <Suspense fallback={<PanelFallback label={t('settings.billingPage.title')} />}>
            <BillingPanel key={workspaceId} workspaceId={workspaceId} />
          </Suspense>
        )}
      </div>
    </Dialog>
  );
}

function PanelFallback({ label }: { label: string }) {
  return (
    <div role='status' aria-label={label} className='flex h-full items-center justify-center'>
      <Progress variant='primary' />
    </div>
  );
}

export default SettingsDialog;
