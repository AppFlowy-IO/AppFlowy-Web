import React, { lazy, Suspense, useEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

import { ViewLayout } from '@/application/types';
import type { SavedDeck, DeckAction } from '@/components/presentation/types';
import { ReactComponent as SuccessIcon } from '@/assets/icons/success.svg';
import { ReactComponent as Templates } from '@/assets/icons/template.svg';
import { useAppView } from '@/components/app/app.hooks';
import PublishPanel from '@/components/app/share/PublishPanel';
import SharePanel from '@/components/app/share/SharePanel';
import TemplatePanel from '@/components/app/share/TemplatePanel';
import { useShareAccessDetails } from '@/components/app/share/useShareAccessDetails';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';
import { useCurrentUser } from '@/components/main/app.hooks';
import { Separator } from '@/components/ui/separator';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';

// Lazy: only loaded when the user opens the Export tab.
const ExportPanel = lazy(() => import('@/components/app/share/ExportPanel'));

const AISlidesSharePanel = lazy(() => import('@/components/presentation/AISlidesSharePanel'));

enum TabKey {
  AI_SLIDES = 'ai_slides',
  SHARE = 'share',
  PUBLISH = 'publish',
  EXPORT_AS = 'export_as',
  TEMPLATE = 'template',
}

function ShareTabs({
  opened,
  viewId,
  publishViewId = viewId,
  hidePublish = false,
  presentationViewId,
  presentationTitle,
  presentationIsRow,
  onPresentationRequest,
  hideExport = false,
  shareUrl,
  onClose,
  onOpenPublishManage,
}: {
  opened: boolean;
  viewId: string;
  publishViewId?: string;
  hidePublish?: boolean;
  presentationViewId?: string;
  presentationTitle?: string;
  presentationIsRow?: boolean;
  onPresentationRequest?: (deck?: SavedDeck, action?: DeckAction) => void;
  hideExport?: boolean;
  shareUrl?: string;
  onClose: () => void;
  onOpenPublishManage?: () => void;
}) {
  const { t } = useTranslation();
  const view = useAppView(viewId);
  const [value, setValue] = React.useState<TabKey>(TabKey.SHARE);
  const activeValue = hidePublish && value === TabKey.PUBLISH ? TabKey.SHARE : value;
  // RightMenu uses hidePublish for full-page database rows. Their access list
  // comes from the containing database and must not be mutated from the row.
  const disablePersonAccessChanges = hidePublish;
  const currentUser = useCurrentUser();
  const {
    people,
    groups,
    editableGroupIds,
    isLoadingPeople,
    loadPeople,
    removePersonFromAccessList,
    updateGroupInAccessList,
    currentUserAccessLevel,
    canManageFullAccess,
    generalAccessLevel,
    sectionType,
  } = useShareAccessDetails(viewId, opened);
  const {
    canManageViewActions: canShare,
    hasLoadedViewActionPermissions,
    isLoadingViewActionPermissions,
  } = useViewActionPermissions(view, opened, viewId);
  const isResolvingSharePermission = isLoadingViewActionPermissions || !hasLoadedViewActionPermissions;

  const options = useMemo(() => {
    return [
      {
        value: TabKey.SHARE,
        label: t('shareAction.shareTab'),
        Panel: SharePanel,
      },
      hidePublish
        ? false
        : {
            value: TabKey.PUBLISH,
            label: t('shareAction.publish'),
            icon: view?.is_published ? <SuccessIcon className={'mb-0 h-5 w-5 text-text-action'} /> : undefined,
            Panel: PublishPanel,
          },
      !hideExport && {
        value: TabKey.EXPORT_AS,
        label: t('shareAction.exportAsTab'),
        Panel: ExportPanel,
      },
      onPresentationRequest &&
        (presentationViewId || (!presentationIsRow && view?.layout === ViewLayout.Document)) && {
          value: TabKey.AI_SLIDES,
          label: 'AI Slides',
          Panel: AISlidesSharePanel,
        },
      !hidePublish &&
        currentUser?.email?.endsWith('appflowy.io') &&
        view?.is_published && {
          value: TabKey.TEMPLATE,
          label: t('template.asTemplate'),
          icon: <Templates className={'mb-0 h-5 w-5'} />,
          Panel: TemplatePanel,
        },
    ].filter(Boolean) as Array<{
      value: TabKey;
      label: string;
      icon?: React.JSX.Element;
      Panel: React.FC<{
        viewId: string;
        onClose: () => void;
        opened: boolean;
        onOpenPublishManage?: () => void;
      }>;
    }>;
  }, [
    currentUser?.email,
    hideExport,
    hidePublish,
    t,
    view?.is_published,
    view?.layout,
    presentationViewId,
    presentationIsRow,
    onPresentationRequest,
  ]);

  useEffect(() => {
    if (opened) {
      setValue(TabKey.SHARE);
    }
  }, [opened]);

  return (
    <Tabs value={activeValue} className='gap-0' onValueChange={(newValue) => setValue(newValue as TabKey)}>
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
          <Suspense fallback={null}>
            {option.value === TabKey.SHARE ? (
              <SharePanel
                viewId={viewId}
                shareUrl={shareUrl}
                people={people}
                groups={groups}
                editableGroupIds={editableGroupIds}
                isLoadingPeople={isLoadingPeople}
                onPeopleChange={loadPeople}
                onPersonRemoved={removePersonFromAccessList}
                updateGroupInAccessList={updateGroupInAccessList}
                hasFullAccess={canShare}
                canManageFullAccess={canShare && canManageFullAccess}
                disablePersonAccessChanges={disablePersonAccessChanges}
                currentUserAccessLevel={currentUserAccessLevel}
                generalAccessLevel={generalAccessLevel}
                sectionType={sectionType}
              />
            ) : option.value === TabKey.PUBLISH ? (
              <PublishPanel
                viewId={publishViewId}
                fallbackViewId={publishViewId === viewId ? undefined : viewId}
                onClose={onClose}
                opened={opened}
                onOpenPublishManage={onOpenPublishManage}
                canShare={canShare}
                // Publishing needs the canonical share permission, not the
                // people/group list, which can still be refreshing separately.
                shareDetailsLoading={isResolvingSharePermission}
              />
            ) : option.value === TabKey.AI_SLIDES ? (
              <AISlidesSharePanel
                viewId={presentationViewId || viewId}
                title={presentationTitle}
                isRow={presentationIsRow}
                permissionViewId={viewId}
                onOpen={onPresentationRequest!}
              />
            ) : (
              <option.Panel
                viewId={viewId}
                onClose={onClose}
                opened={opened}
                onOpenPublishManage={onOpenPublishManage}
              />
            )}
          </Suspense>
        </TabsContent>
      ))}
    </Tabs>
  );
}

export default ShareTabs;
