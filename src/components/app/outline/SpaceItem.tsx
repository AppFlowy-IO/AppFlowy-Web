import SpaceIcon from '@/components/_shared/view-icon/SpaceIcon';
import ViewItem from '@/components/app/outline/ViewItem';
import { Tooltip } from '@mui/material';
import React, { useMemo } from 'react';
import { View } from '@/application/types';
import { ReactComponent as PrivateIcon } from '@/assets/icons/lock.svg';

function SpaceItem({
  view,
  width,
  renderExtra,
  expandIds,
  toggleExpand,
  onClickView,
  onClickSpace,
}: {
  view: View;
  width: number;
  expandIds: string[];
  toggleExpand: (id: string, isExpand: boolean) => void;
  renderExtra?: ({
    hovered,
    view,
  }: {
    hovered: boolean;
    view: View
  }) => React.ReactNode;
  onClickView?: (viewId: string) => void;
  onClickSpace?: (viewId: string) => void;
}) {
  const [hovered, setHovered] = React.useState<boolean>(false);
  const isExpanded = expandIds.includes(view.view_id);
  const isPrivate = view.is_private;
  const renderItem = useMemo(() => {
    if (!view) return null;
    const extra = view?.extra;
    const name = view?.name || '';

    return (
      <div
        style={{
          width,
        }}
        onClick={() => {
          toggleExpand(view.view_id, !isExpanded);
          onClickSpace?.(view.view_id);
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        className={
          'flex items-center select-none px-1 truncate cursor-pointer min-h-[30px] w-full gap-0.5 rounded-[8px] py-0.5  text-sm hover:bg-fill-list-hover focus:bg-content-blue-50 focus:outline-none'
        }
      >
        <SpaceIcon
          className={'icon !h-5 mr-1.5 !w-5 !min-w-5'}
          bgColor={extra?.space_icon_color}
          value={extra?.space_icon || ''}
          char={extra?.space_icon ? undefined : name.slice(0, 1)}
        />
        <Tooltip
          title={name}
          disableInteractive={true}
        >
          <div className={'gap-1 text-sm justify-start flex flex-1 items-center overflow-hidden'}>
            <div className={'truncate font-medium'}>{name}</div>

            {isPrivate &&
              <div className={'min-w-5 min-h-5 text-base text-text-title opacity-80'}>
                <PrivateIcon className='h-5 w-5'/>
              </div>
            }
          </div>
        </Tooltip>
        {
          renderExtra && renderExtra({ hovered, view })
        }
      </div>
    );
  }, [hovered, isExpanded, isPrivate, onClickSpace, renderExtra, toggleExpand, view, width]);

  const renderChildren = useMemo(() => {
    return <div
      className={'flex transform flex-col gap-2 transition-all'}
      style={{
        display: isExpanded ? 'block' : 'none',
      }}
    >{
      view?.children?.map((child) => (
        <ViewItem
          key={child.view_id}
          view={child}
          width={width}
          renderExtra={renderExtra}
          expandIds={expandIds}
          toggleExpand={toggleExpand}
          onClickView={onClickView}
        />
      ))
    }</div>;
  }, [onClickView, isExpanded, view?.children, width, renderExtra, expandIds, toggleExpand]);

  return (
    <div className={'flex h-fit w-full flex-col'}>
      {renderItem}
      {renderChildren}
    </div>
  );
}

export default SpaceItem;