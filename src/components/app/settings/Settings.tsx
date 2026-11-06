import Dialog from '@mui/material/Dialog';
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { Role, SettingMenuItem } from '@/application/types';
import { useCurrentWorkspaceId, useIsOfficialHosted, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import { AccountAppPanel } from '@/components/app/settings/AccountAppPanel';
import { ManageDataPanel } from '@/components/app/settings/ManageDataPanel';
import { useMcpPendingRequestCount } from '@/components/app/settings/mcp/pendingRequestCount';
import { MembersPanel } from '@/components/app/settings/MembersPanel';
import { ProfilePanel } from '@/components/app/settings/ProfilePanel';
import SettingMenu from '@/components/app/settings/SettingMenu';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { useMcpConfiguration, useMcpLicenseRequired } from '@/components/mcp/useMcpConfiguration';
import { Progress } from '@/components/ui/progress';
import { isLocalDevelopment } from '@/utils/runtime-config';
import { canManageWorkspaceBilling } from '@/utils/subscription';

const ConnectionsPanel = lazy(() =>
  import('@/components/app/settings/ConnectionsPanel').then((module) => ({ default: module.ConnectionsPanel }))
);
const PlanPanel = lazy(() =>
  import('@/components/app/settings/PlanPanel').then((module) => ({ default: module.PlanPanel }))
);
const BillingPanel = lazy(() =>
  import('@/components/app/settings/BillingPanel').then((module) => ({ default: module.BillingPanel }))
);
const McpPanel = lazy(() => import('@/components/app/settings/mcp/McpPanel'));

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
  // The app's auth layer runs the server-info loop this reads.
  const mcpConfiguration = useMcpConfiguration();
  const mcpLicenseRequired = useMcpLicenseRequired();
  const [selectedItem, setSelectedItem] = useState<SettingMenuItem>(SettingMenuItem.ACCOUNT);

  const currentWorkspace = useMemo(
    () => userWorkspaceInfo?.workspaces.find((workspace) => workspace.id === workspaceId),
    [userWorkspaceInfo?.workspaces, workspaceId]
  );
  // Billing exists only on the official cloud, and only the owner can change a workspace's plan.
  const showBilling = canManageWorkspaceBilling(currentWorkspace, currentUser?.uid, isOfficialHosted);
  // The MCP service is not ready on the servers yet, so only local development (`pnpm dev`) offers the MCP tab.
  // Production builds hide it, even where server-info names the service.
  const aiAppsAllowed = isLocalDevelopment();
  // The MCP tab exists where the MCP service is known (APPFLOWY_MCP_BASE_URL or Cloud server-info's mcp_url), and
  // on a self-hosted server whose license does not include MCP, where it asks for a license upgrade.
  const showAiApps = aiAppsAllowed && (mcpConfiguration.status === 'configured' || mcpLicenseRequired);
  const aiAppsMissing = !aiAppsAllowed || (mcpConfiguration.status === 'not_configured' && !mcpLicenseRequired);
  // Owners see how many AI app approval requests are waiting.
  const aiAppsPendingRequests = useMcpPendingRequestCount(
    workspaceId,
    open && showAiApps && currentWorkspace?.role === Role.Owner
  );

  useEffect(() => {
    if (!showBilling && (selectedItem === SettingMenuItem.PLAN || selectedItem === SettingMenuItem.BILLING)) {
      setSelectedItem(SettingMenuItem.ACCOUNT);
    }
  }, [selectedItem, showBilling]);

  useEffect(() => {
    // While server-info loads, a `?setting=AI_APPS` deep link waits for the answer.
    if (aiAppsMissing && selectedItem === SettingMenuItem.AI_APPS) {
      setSelectedItem(SettingMenuItem.ACCOUNT);
    }
  }, [selectedItem, aiAppsMissing]);

  useEffect(() => {
    const item = search.get('setting');

    if (item) {
      const requested = Object.values(SettingMenuItem).find((value) => value === item) ?? SettingMenuItem.ACCOUNT;

      // Without the MCP tab, its deep link opens Account rather than flashing the tab's loading state.
      setSelectedItem(requested === SettingMenuItem.AI_APPS && !aiAppsAllowed ? SettingMenuItem.ACCOUNT : requested);
      onRequestOpen?.();
      setSearch((prev) => {
        prev.delete('setting');
        return prev;
      });
    }
  }, [search, setSearch, onRequestOpen, aiAppsAllowed]);

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
      <SettingMenu
        onSelectItem={setSelectedItem}
        selectedItem={selectedItem}
        showBilling={showBilling}
        showAiApps={showAiApps}
        aiAppsPendingRequests={aiAppsPendingRequests}
      />
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
        {open &&
          selectedItem === SettingMenuItem.AI_APPS &&
          workspaceId &&
          (showAiApps ? (
            <Suspense fallback={<PanelFallback label={t('settings.mcp.loading')} />}>
              <McpPanel
                key={workspaceId}
                workspaceId={workspaceId}
                onOpenConnections={() => setSelectedItem(SettingMenuItem.CONNECTIONS)}
              />
            </Suspense>
          ) : (
            <PanelFallback label={t('settings.mcp.loading')} />
          ))}
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
