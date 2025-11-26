import React, { useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as SuccessIcon } from '@/assets/icons/success.svg';
import { ReactComponent as Templates } from '@/assets/icons/template.svg';
import { useAppView } from '@/components/app/app.hooks';
import PublishPanel from '@/components/app/share/PublishPanel';
import SharePanel from '@/components/app/share/SharePanel';
import TemplatePanel from '@/components/app/share/TemplatePanel';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

enum TabKey {
  SHARE = 'share',
  PUBLISH = 'publish',
  TEMPLATE = 'template',
}

function ShareTabs({
  opened,
  viewId,
  onClose,
  onOpenPublishManage,
}: {
  opened: boolean;
  viewId: string;
  onClose: () => void;
  onOpenPublishManage?: () => void;
}) {
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
        icon: view?.is_published ? <SuccessIcon className={'mb-0 h-5 w-5 text-text-action'} /> : undefined,
        Panel: PublishPanel,
      },
      currentUser?.email?.endsWith('appflowy.io') &&
        view?.is_published && {
          value: TabKey.TEMPLATE,
          label: t('template.asTemplate'),
          icon: <Templates className={'mb-0 h-5 w-5'} />,
          Panel: TemplatePanel,
        },
    ].filter(Boolean) as Array<
      {
        value: TabKey;
        label: string;
        icon?: React.JSX.Element;
        Panel: React.FC<{
          viewId: string;
          onClose: () => void;
          opened: boolean;
          onOpenPublishManage?: () => void;
        }>;
      }
    >;
  }, [currentUser?.email, t, view?.is_published]);

  useEffect(() => {
    if (opened) {
      setValue(TabKey.SHARE);
    }
  }, [opened]);

  return (
    <Tabs value={value} className='gap-0' onValueChange={(newValue) => setValue(newValue as TabKey)}>
      <TabsList className={'flex w-full items-center justify-start px-3 pt-3'}>
        {opened &&
          options.map((option) => (
            <TabsTrigger
              className={'flex flex-row items-center justify-center gap-3 px-1.5 pb-1.5'}
              key={option.value}
              value={option.value}
              data-testid={option.value === TabKey.PUBLISH ? 'publish-tab' : undefined}
            >
              {option.icon}
              {option.label}
            </TabsTrigger>
          ))}
      </TabsList>
      <Separator className='my-0' />
      {options.map((option) => (
        <TabsContent key={option.value} value={option.value}>
          <option.Panel
            viewId={viewId}
            onClose={onClose}
            opened={opened}
            onOpenPublishManage={onOpenPublishManage}
          />
        </TabsContent>
      ))}
    </Tabs>
  );
}

export default ShareTabs;
