import { View } from '@/components/chat/types';

import { ViewItem } from '../add-messages-to-page-wrapper/view-item';

function ViewList({
  item,
  onCreateViewWithContent,
  onInsertContentToView,
}: {
  item: View;
  onCreateViewWithContent: (parentViewId: string) => void;
  onInsertContentToView: (viewId: string) => void;
}) {
  if(!item.children || item.children.length === 0) {
    return null;
  }

  return (
    <div className={'flex pl-4 flex-col gap-1'}>
      {item.children.map((view: View) => {
        return (
          <ViewItem
            key={view.view_id}
            view={view}
            onCreateViewWithContent={onCreateViewWithContent}
            onInsertContentToView={onInsertContentToView}
          >
            <ViewList
              onCreateViewWithContent={onCreateViewWithContent}
              onInsertContentToView={onInsertContentToView}
              item={view}
            />
          </ViewItem>
        );
      })}
    </div>
  );
}

export default ViewList;