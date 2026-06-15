import { useTranslation } from 'react-i18next';

import LoadingDots from '@/components/chat/components/ui/loading-dots';
import SpaceItem from '@/components/chat/components/view/space-item';
import ViewChildren from '@/components/chat/components/view/view-children';
import { View } from '@/components/chat/types';
import { CheckStatus } from '@/components/chat/types/checkbox';

interface SpacesProps {
  getCheckStatus: (view: View) => CheckStatus;
  getInitialExpand: (viewId: string) => boolean;
  onToggle: (view: View) => void;
  spaces: View[];
  viewsLoading: boolean;
}

export function Spaces({
  getCheckStatus,
  onToggle,
  spaces,
  viewsLoading,
  getInitialExpand,
}: SpacesProps) {
  const { t } = useTranslation();

  if(viewsLoading) {
    return <div className={'flex w-full h-full items-center py-10 justify-center'}>
      <LoadingDots />
    </div>;
  }

  if(!spaces || spaces.length === 0) {
    return <div className={'flex w-full opacity-60 h-full py-10 items-center justify-center'}>
      {t('chat.search.noSpacesFound')}
    </div>;
  }

  return (
    <div className={'flex flex-col gap-1 h-full w-full'}>
      {spaces.map((view: View) => {
        return (
          <SpaceItem
            key={view.view_id}
            view={view}
            getInitialExpand={getInitialExpand}
          >
            <ViewChildren
              item={view}
              onToggle={onToggle}
              getCheckStatus={getCheckStatus}
              getInitialExpand={getInitialExpand}
            />
          </SpaceItem>
        );
      })}
    </div>
  );
}

