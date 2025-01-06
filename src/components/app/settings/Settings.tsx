import { SettingMenuItem } from '@/application/types';
import { ReactComponent as SettingsIcon } from '@/assets/settings.svg';
import SettingMenu from '@/components/app/settings/SettingMenu';
import { Button, Dialog } from '@mui/material';
import React, { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

export function Settings () {
  const { t } = useTranslation();
  const [open, setOpen] = React.useState(false);
  const [search, setSearch] = useSearchParams();

  const [selectedItem, setSelectedItem] = React.useState<SettingMenuItem>(SettingMenuItem.ACCOUNT);

  useEffect(() => {
    const item = search.get('setting') as SettingMenuItem;

    if (item) {
      setOpen(true);
      setSelectedItem(item);
      setSearch(prev => {
        prev.delete('setting');
        return prev;
      });
    }
  }, [search, setSearch]);

  return (
    <>
      <Button
        size={'small'}
        className={'justify-start px-2'}
        color={'inherit'}
        onClick={() => {
          setOpen(true);
        }}
        startIcon={<SettingsIcon />}
      >{t('settings.title')}
      </Button>
      <Dialog
        classes={{
          paper: 'w-[700px] flex bg-bg-body max-w-[90vw] max-h-[90vh] h-[600px] overflow-y-auto',
        }}
        open={open}
        onClose={() => setOpen(false)}
      >
        <SettingMenu
          onSelectItem={setSelectedItem}
          selectedItem={selectedItem}
        />
      </Dialog>
    </>
  );
}

export default Settings;