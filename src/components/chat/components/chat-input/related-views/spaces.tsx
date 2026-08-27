import { useTranslation } from 'react-i18next';

import { isSpaceView } from '@/components/ai-chat/rag-scope';
import LoadingDots from '@/components/chat/components/ui/loading-dots';
import SpaceItem from '@/components/chat/components/view/space-item';
import { ViewChildren } from '@/components/chat/components/view/view-children';
import { ViewItem } from '@/components/chat/components/view/view-item';
import { View } from '@/components/chat/types';
import { CheckStatus } from '@/components/chat/types/checkbox';

interface SpacesProps {
  getCheckStatus: (view: View) => CheckStatus;
  onToggle: (view: View) => void;
  spaces: View[];
  viewsLoading: boolean;
  getInitialExpand: (viewId: string) => boolean;
}

export function Spaces({ getCheckStatus, onToggle, spaces, viewsLoading, getInitialExpand }: SpacesProps) {
  const { t } = useTranslation();

  if (viewsLoading) {
    return (
      <div className={'flex h-full w-full items-center justify-center py-10'}>
        <LoadingDots />
      </div>
    );
  }

  if (!spaces || spaces.length === 0) {
    return (
      <div className={'flex h-full w-full items-center justify-center py-10 opacity-60'}>
        {t('chat.search.noSpacesFound')}
      </div>
    );
  }

  return (
    <div className={'flex h-full w-full flex-col gap-1'}>
      {spaces.map((view: View) => {
        const children = (
          <ViewChildren
            item={view}
            getInitialExpand={getInitialExpand}
            onToggle={onToggle}
            getCheckStatus={getCheckStatus}
          />
        );

        return isSpaceView(view) ? (
          <SpaceItem key={view.view_id} view={view} getInitialExpand={getInitialExpand}>
            {children}
          </SpaceItem>
        ) : (
          <ViewItem
            key={view.view_id}
            view={view}
            getInitialExpand={getInitialExpand}
            onToggle={onToggle}
            getCheckStatus={getCheckStatus}
          >
            {children}
          </ViewItem>
        );
      })}
    </div>
  );
}
