import { useAppView } from '@/components/app/app.hooks';
import PublishPanel from '@/components/app/share/PublishPanel';
import TemplatePanel from '@/components/app/share/TemplatePanel';
import SharePanel from '@/components/app/share/SharePanel';
import { useCurrentUser } from '@/components/main/app.hooks';
import React, { useCallback, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { ViewTabs, ViewTab, TabPanel } from 'src/components/_shared/tabs/ViewTabs';
import { ReactComponent as Templates } from '@/assets/icons/template.svg';

import { ReactComponent as SuccessIcon } from '@/assets/icons/success.svg';

enum TabKey {
  SHARE = 'share',
  PUBLISH = 'publish',
  TEMPLATE = 'template',
}

function ShareTabs({ opened, viewId, onClose }: { opened: boolean; viewId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const view = useAppView(viewId);
  const [value, setValue] = React.useState<TabKey>(TabKey.SHARE);
  const currentUser = useCurrentUser();

  const options = useMemo(() => {
    return [
      {
        value: TabKey.SHARE,
        label: t('shareAction.shareTab'),
        Panel: SharePanel,
      },
      {
        value: TabKey.PUBLISH,
        label: t('shareAction.publish'),
        icon: view?.is_published ? <SuccessIcon className={'mb-0 h-5 w-5 text-fill-default'} /> : undefined,
        Panel: PublishPanel,
      },
      currentUser?.email?.endsWith('appflowy.io') &&
        view?.is_published && {
          value: TabKey.TEMPLATE,
          label: t('template.asTemplate'),
          icon: <Templates className={'mb-0 h-5 w-5'} />,
          Panel: TemplatePanel,
        },
    ].filter(Boolean) as {
      value: TabKey;
      label: string;
      icon?: React.JSX.Element;
      Panel: React.FC<{ viewId: string; onClose: () => void; opened: boolean }>;
    }[];
  }, [currentUser?.email, t, view?.is_published]);

  const onChange = useCallback((_event: React.SyntheticEvent, newValue: TabKey) => {
    setValue(newValue);
  }, []);

  useEffect(() => {
    if (opened) {
      setValue(TabKey.SHARE);
    }
  }, [opened]);

  return (
    <>
      <ViewTabs className={'border-b border-line-divider'} onChange={onChange} value={value}>
        {opened &&
          options.map((option) => (
            <ViewTab
              className={'flex flex-row items-center justify-center gap-1.5'}
              key={option.value}
              value={option.value}
              label={option.label}
              icon={option.icon}
            />
          ))}
      </ViewTabs>
      <div className={'p-2'}>
        {options.map((option) => (
          <TabPanel
            className={'w-[500px] min-w-[500px] max-w-full max-sm:min-w-[80vw]'}
            key={option.value}
            index={option.value}
            value={value}
          >
            <option.Panel viewId={viewId} onClose={onClose} opened={opened} />
          </TabPanel>
        ))}
      </div>
    </>
  );
}

export default ShareTabs;
