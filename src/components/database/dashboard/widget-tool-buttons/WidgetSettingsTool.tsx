import { useTranslation } from 'react-i18next';

import { ReactComponent as WidgetSettingsIcon } from '@/assets/icons/controller.svg';

import { useWidgetContext } from '../WidgetContext';

import { WidgetToolButton } from './WidgetToolButton';

/**
 * A widget's Edit-mode Settings tool: it toggles the widget's settings host
 * (`WidgetSettingsHost`). It is the host's `settingsToolRef`, so a press on
 * it is not an outside press, and the focus returns to it when the host
 * closes.
 */
export function WidgetSettingsTool() {
  const { t } = useTranslation();
  const { settingsOpen, setSettingsOpen, actions, settingsToolRef } = useWidgetContext();

  return (
    <WidgetToolButton
      accent
      className='data-[state=open]:bg-dash-hover-fill'
      data-state={settingsOpen ? 'open' : 'closed'}
      data-testid='dashboard-widget-settings-button'
      icon={WidgetSettingsIcon}
      label={t('dashboard.widget.settings', { defaultValue: 'Settings' })}
      onClick={(event) => {
        event.stopPropagation();
        if (settingsOpen) setSettingsOpen(false);
        else actions.openSettings();
      }}
      parityId='dash-widget-tool-settings'
      ref={settingsToolRef}
    />
  );
}

export default WidgetSettingsTool;
