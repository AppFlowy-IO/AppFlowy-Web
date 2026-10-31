import React, { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';

import { ViewLayout } from '@/application/types';
import { NormalModal } from '@/components/_shared/modal';
import { useAppView } from '@/components/app/app.hooks';
import { PublishManage } from '@/components/app/publish-manage';
import ShareTabs from '@/components/app/share/ShareTabs';
import { Button } from '@/components/ui/button';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { cn } from '@/lib/utils';
import type { SavedDeck, DeckAction } from '@/components/presentation/types';

const PresentationDialog = lazy(() => import('@/components/presentation/PresentationDialog'));

export function ShareButton({
  viewId,
  publishViewId = viewId,
  hidePublish = false,
  presentationViewId,
  presentationTitle,
  presentationIsRow,
  hideExport = false,
  shareUrl,
  className,
}: {
  viewId: string;
  publishViewId?: string;
  hidePublish?: boolean;
  presentationViewId?: string;
  presentationTitle?: string;
  presentationIsRow?: boolean;
  hideExport?: boolean;
  shareUrl?: string;
  className?: string;
}) {
  const { t } = useTranslation();

  const view = useAppView(viewId);
  const layout = view?.layout;
  const [opened, setOpened] = React.useState(false);
  const [publishManageOpen, setPublishManageOpen] = React.useState(false);
  const [presentation, setPresentation] = React.useState<{ deck?: SavedDeck; action?: DeckAction }>();
  const publishManageVisible = publishManageOpen && !hidePublish;

  if (layout === ViewLayout.AIChat) return null;

  return (
    <>
      <Popover modal={!presentation} open={opened} onOpenChange={setOpened}>
        <PopoverTrigger asChild>
          <Button className={cn('mx-2', className)} data-testid={'share-button'} size={'sm'} variant={'default'}>
            {t('shareAction.buttonText')}
          </Button>
        </PopoverTrigger>
        <PopoverContent
          onCloseAutoFocus={(e) => e.preventDefault()}
          side='bottom'
          align='end'
          alignOffset={-20}
          className={'h-fit min-w-[480px] max-w-[480px]'}
          data-testid={'share-popover'}
        >
          <ShareTabs
            opened={opened}
            viewId={viewId}
            publishViewId={publishViewId}
            hidePublish={hidePublish}
            presentationViewId={presentationViewId}
            presentationTitle={presentationTitle}
            presentationIsRow={presentationIsRow}
            hideExport={hideExport}
            shareUrl={shareUrl}
            onClose={() => setOpened(false)}
            onPresentationRequest={(deck, action) => {
              setOpened(false);
              setPresentation({ deck, action });
            }}
            onOpenPublishManage={() => {
              setOpened(false);
              setPublishManageOpen(true);
            }}
          />
        </PopoverContent>
      </Popover>
      {presentation && (
        <Suspense fallback={null}>
          <PresentationDialog
            mode='slides'
            viewId={presentationViewId || viewId}
            permissionViewId={viewId}
            title={presentationTitle}
            isRow={presentationIsRow}
            deck={presentation.deck}
            action={presentation.action}
            onClose={() => setPresentation(undefined)}
          />
        </Suspense>
      )}
      <NormalModal
        data-testid='publish-manage-modal'
        open={publishManageVisible}
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
