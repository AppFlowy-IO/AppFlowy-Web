import React, { useCallback, useMemo } from 'react';

import { UIVariant, View } from '@/application/types';
import { ReactComponent as PrivateIcon } from '@/assets/icons/lock.svg';
import OutlineIcon from '@/components/_shared/outline/OutlineIcon';
import OutlineItemContent from '@/components/_shared/outline/OutlineItemContent';

function OutlineItem({
  view,
  level = 0,
  selectedViewId,
  navigateToView,
  variant,
}: {
  view: View;
  level?: number;
  selectedViewId?: string;
  navigateToView?: (viewId: string) => Promise<void>;
  variant?: UIVariant;
}) {
  const selected = selectedViewId === view.view_id;
  const [isExpanded, setIsExpanded] = React.useState(false);
  const getIcon = useCallback(() => {
    return (
      <span className={'text-[1em]'}>
        <OutlineIcon level={level} isExpanded={isExpanded} setIsExpanded={setIsExpanded} />
      </span>
    );
  }, [isExpanded, level]);
  const renderItem = useCallback(
    (item: View) => {
      return (
        <div className={'flex h-fit w-full flex-col  gap-2'}>
          <div
            style={{
              backgroundColor: selected ? 'var(--fill-content-hover)' : undefined,
            }}
            className={
              'flex w-full items-center gap-1 rounded-[8px] px-1 py-2 text-lg focus:bg-fill-theme-select focus:outline-none'
            }
          >
            {item.children?.length ? getIcon() : null}

            <OutlineItemContent
              variant={variant}
              item={item}
              navigateToView={navigateToView}
              level={level}
              setIsExpanded={setIsExpanded}
            />
            {item.is_private && <PrivateIcon className={'h-5 w-5 text-text-secondary'} />}
          </div>
        </div>
      );
    },
    [getIcon, level, navigateToView, variant, selected]
  );

  const children = useMemo(() => view.children || [], [view.children]);

  const renderChildren = useMemo(() => {
    return (
      <div
        className={'flex transform flex-col gap-2 transition-all'}
        style={{
          display: isExpanded ? 'block' : 'none',
        }}
      >
        {children.map((item, index) => (
          <OutlineItem
            selectedViewId={selectedViewId}
            navigateToView={navigateToView}
            level={level + 1}
            key={index}
            view={item}
            variant={variant}
          />
        ))}
      </div>
    );
  }, [children, isExpanded, level, navigateToView, selectedViewId, variant]);

  return (
    <div className={'flex h-fit w-full flex-col'}>
      {renderItem(view)}
      {renderChildren}
    </div>
  );
}

export default OutlineItem;
