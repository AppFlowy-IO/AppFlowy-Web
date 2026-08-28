import { Dialog } from '@mui/material';
import React, { useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';

import { SettingMenuItem } from '@/application/types';
import { AccountAppPanel } from '@/components/app/settings/AccountAppPanel';
import { ManageDataPanel } from '@/components/app/settings/ManageDataPanel';
import { MembersPanel } from '@/components/app/settings/MembersPanel';
import { ProfilePanel } from '@/components/app/settings/ProfilePanel';
import SettingMenu from '@/components/app/settings/SettingMenu';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onRequestOpen?: () => void;
}

export function SettingsDialog({ open, onClose, onRequestOpen }: SettingsDialogProps) {
  const [search, setSearch] = useSearchParams();
  const [selectedItem, setSelectedItem] = React.useState<SettingMenuItem>(SettingMenuItem.ACCOUNT);

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
      <div className='flex min-h-0 flex-1 flex-col overflow-hidden'>
        {selectedItem === SettingMenuItem.ACCOUNT && <AccountAppPanel />}
        {selectedItem === SettingMenuItem.PROFILE && <ProfilePanel />}
        {selectedItem === SettingMenuItem.MEMBERS && <MembersPanel />}
        {selectedItem === SettingMenuItem.MANAGE_DATA && <ManageDataPanel />}
      </div>
    </Dialog>
  );
}

export default SettingsDialog;
