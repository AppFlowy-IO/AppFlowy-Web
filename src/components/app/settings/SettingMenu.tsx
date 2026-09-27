import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { SettingMenuItem } from '@/application/types';
import { ReactComponent as ManageDataIcon } from '@/assets/icons/database.svg';
import { ReactComponent as ConnectionsIcon } from '@/assets/icons/link.svg';
import { ReactComponent as BillingIcon } from '@/assets/icons/settings_credit_card.svg';
import { ReactComponent as PlanIcon } from '@/assets/icons/settings_plan.svg';
import { ReactComponent as ProfileIcon } from '@/assets/icons/person.svg';
import { ReactComponent as PersonIcon } from '@/assets/icons/user.svg';
import { ReactComponent as MembersIcon } from '@/assets/icons/users.svg';

interface SettingMenuProps {
  selectedItem: SettingMenuItem;
  onSelectItem: (item: SettingMenuItem) => void;
  /** Plan and Billing exist only for workspace owners on the official AppFlowy cloud. */
  showBilling?: boolean;
}

function SettingMenu({ selectedItem, onSelectItem, showBilling = false }: SettingMenuProps) {
  const { t } = useTranslation();

  const options = useMemo(() => {
    return [
      {
        value: SettingMenuItem.ACCOUNT,
        label: t('settings.accountPage.menuLabelAccountApp'),
        IconComponent: PersonIcon,
      },
      {
        value: SettingMenuItem.PROFILE,
        label: t('settings.accountPage.menuLabelProfile'),
        IconComponent: ProfileIcon,
      },
      {
        value: SettingMenuItem.MEMBERS,
        label: t('settings.appearance.people.label'),
        IconComponent: MembersIcon,
      },
      {
        value: SettingMenuItem.MANAGE_DATA,
        label: t('settings.manageData.menuLabel'),
        IconComponent: ManageDataIcon,
      },
      {
        value: SettingMenuItem.CONNECTIONS,
        label: t('settings.connections.menuLabel'),
        IconComponent: ConnectionsIcon,
      },
      ...(showBilling
        ? [
            {
              value: SettingMenuItem.PLAN,
              label: t('settings.planPage.menuLabel'),
              IconComponent: PlanIcon,
            },
            {
              value: SettingMenuItem.BILLING,
              label: t('settings.billingPage.menuLabel'),
              IconComponent: BillingIcon,
            },
          ]
        : []),
    ];
  }, [showBilling, t]);

  return (
    <div className={'flex h-full w-[228px] flex-col gap-1 overflow-y-auto overflow-x-hidden bg-surface-container-layer-01 px-2 py-4'}>
      {options.map((option) => (
        <div
          key={option.value}
          data-testid={`settings-menu-${option.value.toLowerCase()}`}
          onClick={() => onSelectItem(option.value)}
          className={`flex cursor-pointer items-center gap-3 rounded-[8px] px-3 py-2 hover:bg-fill-content-hover ${
            option.value === selectedItem ? 'bg-fill-content-hover' : ''
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
