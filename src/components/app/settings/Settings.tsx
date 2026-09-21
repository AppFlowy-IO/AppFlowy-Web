import Dialog from '@mui/material/Dialog';
import { lazy, Suspense, useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { SettingMenuItem } from '@/application/types';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { AccountAppPanel } from '@/components/app/settings/AccountAppPanel';
import { ManageDataPanel } from '@/components/app/settings/ManageDataPanel';
import { MembersPanel } from '@/components/app/settings/MembersPanel';
import { ProfilePanel } from '@/components/app/settings/ProfilePanel';
import SettingMenu from '@/components/app/settings/SettingMenu';
import { Progress } from '@/components/ui/progress';

const ConnectionsPanel = lazy(() =>
  import('@/components/app/settings/ConnectionsPanel').then((module) => ({ default: module.ConnectionsPanel }))
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
  const navigate = useNavigate();
  const [selectedItem, setSelectedItem] = useState<SettingMenuItem>(SettingMenuItem.ACCOUNT);

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
      <SettingMenu onSelectItem={setSelectedItem} selectedItem={selectedItem} />
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
            <ConnectionsPanel
              key={workspaceId}
              workspaceId={workspaceId}
              onOpenSpace={(spaceId) => {
                onClose();
                navigate(`/app/${encodeURIComponent(workspaceId)}/${encodeURIComponent(spaceId)}`);
              }}
            />
          </Suspense>
        )}
      </div>
    </Dialog>
  );
}

export default SettingsDialog;
