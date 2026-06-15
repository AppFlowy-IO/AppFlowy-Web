import { View } from '@/components/chat/types';

import { ViewItem } from './view-item';

function ViewList({
  item,
  onSelectDatabaseView,
}: {
  item: View;
  onSelectDatabaseView: (viewId: string) => void;
}) {
  if (!item.children || item.children.length === 0) {
    return null;
  }

  return (
    <div className={'flex pl-4 flex-col gap-1'}>
      {item.children.map((view: View) => {
        return (
          <ViewItem
            key={view.view_id}
            view={view}
            onSelectDatabaseView={onSelectDatabaseView}
          >
            <ViewList onSelectDatabaseView={onSelectDatabaseView} item={view} />
          </ViewItem>
        );
      })}
    </div>
  );
}

export default ViewList;
