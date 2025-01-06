import { SettingMenuItem } from '@/application/types';
import { ReactComponent as PersonIcon } from '@/assets/person.svg';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface SettingMenuProps {
  selectedItem: SettingMenuItem;
  onSelectItem: (item: SettingMenuItem) => void;
}

function SettingMenu ({
  selectedItem,
  onSelectItem,
}: SettingMenuProps) {
  const { t } = useTranslation();

  const options = useMemo(() => {
    return [
      {
        value: SettingMenuItem.ACCOUNT,
        label: t('settings.accountPage.menuLabel'),
        IconComponent: PersonIcon,
      },
      {
        value: SettingMenuItem.WORKSPACE,
        label: t('settings.workspacePage.menuLabel'),
        IconComponent: PersonIcon,
      },
      {
        value: SettingMenuItem.MEMBERS,
        label: t('settings.appearance.members.label'),
        IconComponent: PersonIcon,
      },
      {
        value: SettingMenuItem.SITES,
        label: t('settings.sites.title'),
        IconComponent: PersonIcon,
      },
    ];
  }, [t]);

  return (
    <div className={'bg-bg-base flex flex-col gap-3 py-4 px-2 overflow-x-hidden overflow-y-auto h-full w-[228px]'}>
      {options.map(option => (
        <div
          key={option.value}
          onClick={() => onSelectItem(option.value)}
          className={`flex items-center gap-3 p-2 rounded-[8px] hover:bg-fill-list-hover cursor-pointer ${option.value === selectedItem ? 'bg-fill-list-hover' : ''}`}
        >
          <option.IconComponent className={'w-6 h-6'} />
          <span className={'text-sm font-medium'}>{option.label}</span>
        </div>
      ))}
    </div>
  );
}

export default SettingMenu;