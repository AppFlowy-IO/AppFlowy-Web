import { SettingMenuItem } from '@/application/types';
import { ReactComponent as PersonIcon } from '@/assets/icons/user.svg';
import React, { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

interface SettingMenuProps {
  selectedItem: SettingMenuItem;
  onSelectItem: (item: SettingMenuItem) => void;
}

function SettingMenu({ selectedItem, onSelectItem }: SettingMenuProps) {
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
    <div className={'flex h-full w-[228px] flex-col gap-3 overflow-y-auto overflow-x-hidden bg-bg-base py-4 px-2'}>
      {options.map((option) => (
        <div
          key={option.value}
          onClick={() => onSelectItem(option.value)}
          className={`flex cursor-pointer items-center gap-3 rounded-[8px] p-2 hover:bg-fill-list-hover ${
            option.value === selectedItem ? 'bg-fill-list-hover' : ''
          }`}
        >
          <option.IconComponent className={'h-5 w-5'} />
          <span className={'text-sm font-medium'}>{option.label}</span>
        </div>
      ))}
    </div>
  );
}

export default SettingMenu;
