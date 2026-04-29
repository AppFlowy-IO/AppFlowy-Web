import React, { useCallback, useEffect, useMemo } from 'react';

import { UIVariant, View, ViewLayout } from '@/application/types';
import { ReactComponent as PrivateIcon } from '@/assets/icons/lock.svg';
import OutlineIcon from '@/components/_shared/outline/OutlineIcon';
import OutlineItemContent from '@/components/_shared/outline/OutlineItemContent';
import { getOutlineExpands, setOutlineExpands } from '@/components/_shared/outline/utils';
import { useAIEnabled } from '@/components/app/app.hooks';

function OutlineItem({
  view,
  level = 0,
  width,
  navigateToView,
  selectedViewId,
  variant,
}: {
  view: View;
  width?: number;
  level?: number;
  selectedViewId?: string;
  navigateToView?: (viewId: string) => Promise<void>;
  variant?: UIVariant;
}) {
  const selected = selectedViewId === view.view_id;
  const aiEnabled = useAIEnabled();
  const [isExpanded, setIsExpanded] = React.useState(() => {
    return getOutlineExpands()[view.view_id] || false;
  });

  useEffect(() => {
    setOutlineExpands(view.view_id, isExpanded);
  }, [isExpanded, view.view_id]);

  const getIcon = useCallback(() => {
    return (
      <span className={'mt-1 text-sm'}>
        <OutlineIcon level={level} isExpanded={isExpanded} setIsExpanded={setIsExpanded} />
      </span>
    );
  }, [isExpanded, level]);

  const renderItem = useCallback(
    (item: View) => {
      return (
        <div
          data-testid={`outline-item-${item.view_id}`}
          className={`flex ${
            variant === UIVariant.App ? 'folder-view-item' : ''
          } my-0.5 h-fit w-full cursor-pointer justify-between`}
        >
          <div
            style={{
              width,
              backgroundColor: selected ? 'var(--fill-content-hover)' : undefined,
            }}
            id={`${variant}-view-${item.view_id}`}
            className={
              'flex min-h-[30px] w-full items-center gap-0.5 rounded-[8px] text-sm hover:bg-fill-theme-select focus:bg-fill-theme-select focus:outline-none'
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
    [variant, width, selected, getIcon, navigateToView, level]
  );

  const children = useMemo(() => {
    if (aiEnabled) return view.children || [];
    return (view.children || []).filter((item) => item.layout !== ViewLayout.AIChat);
  }, [aiEnabled, view.children]);

  const renderChildren = useMemo(() => {
    return (
      <div
        className={'flex transform flex-col transition-all'}
        style={{
          display: isExpanded ? 'block' : 'none',
        }}
      >
        {children.map((item, index) => (
          <OutlineItem
            selectedViewId={selectedViewId}
            navigateToView={navigateToView}
            level={level + 1}
            width={width}
            key={index}
            view={item}
            variant={variant}
          />
        ))}
      </div>
    );
  }, [children, isExpanded, level, navigateToView, selectedViewId, width, variant]);

  if (!aiEnabled && view.layout === ViewLayout.AIChat) return null;

  return (
    <div className={'flex h-fit w-full flex-col'}>
      {renderItem(view)}
      {renderChildren}
    </div>
  );
}

export default OutlineItem;
