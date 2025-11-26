import React from 'react';
import { useTranslation } from 'react-i18next';

import { ViewLayout } from '@/application/types';
import { useAppView } from '@/components/app/app.hooks';
import ShareTabs from '@/components/app/share/ShareTabs';
import { PublishManage } from '@/components/app/publish-manage';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { NormalModal } from '@/components/_shared/modal';

export function ShareButton({ viewId }: { viewId: string }) {
  const { t } = useTranslation();

  const view = useAppView(viewId);
  const layout = view?.layout;
  const [opened, setOpened] = React.useState(false);
  const [publishManageOpen, setPublishManageOpen] = React.useState(false);

  if (layout === ViewLayout.AIChat) return null;

  return (
    <>
      <Popover open={opened} onOpenChange={setOpened}>
        <PopoverTrigger asChild>
          <Button className={'mx-2'} data-testid={'share-button'} size={'sm'} variant={'default'}>
            {t('shareAction.buttonText')}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          side='bottom'
          align='end'
          alignOffset={-20}
          className={'h-fit min-w-[480px] max-w-[480px]'}
          data-testid={'share-popover'}
        >
          <ShareTabs
            opened={opened}
            viewId={viewId}
            onClose={() => setOpened(false)}
            onOpenPublishManage={() => {
              setOpened(false);
              setPublishManageOpen(true);
            }}
          />
        </PopoverContent>
      </Popover>
      <NormalModal
        data-testid='publish-manage-modal'
        open={publishManageOpen}
        onClose={() => setPublishManageOpen(false)}
        scroll='paper'
        overflowHidden
        okButtonProps={{
          className: 'hidden',
        }}
        cancelButtonProps={{
          className: 'hidden',
        }}
        classes={{
          paper: 'w-[700px] appflowy-scroller max-w-[90vw] max-h-[90vh] h-[600px] overflow-hidden',
        }}
        title={<div className={'flex items-center justify-start'}>{t('settings.sites.title')}</div>}
      >
        <div className={'h-full w-full overflow-y-auto overflow-x-hidden'}>
          <PublishManage onClose={() => setPublishManageOpen(false)} />
        </div>
      </NormalModal>
    </>
  );
}

export default ShareButton;
