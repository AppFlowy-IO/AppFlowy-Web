import { View, ViewIconType, ViewLayout } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import OutlineIcon from '@/components/_shared/outline/OutlineIcon';
import { Origins } from '@/components/_shared/popover';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { useAppHandlers, useAppViewId } from '@/components/app/app.hooks';
import { Tooltip } from '@mui/material';
import React, { lazy, Suspense, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';

const ChangeIconPopover = lazy(() => import('@/components/_shared/view-icon/ChangeIconPopover'));

const popoverProps: Origins = {
  transformOrigin: {
    vertical: 'top',
    horizontal: 'left',
  },
  anchorOrigin: {
    vertical: 30,
    horizontal: 'left',
  },
};

function ViewItem({ view, width, level = 0, renderExtra, expandIds, toggleExpand, onClickView }: {
  view: View;
  width: number;
  level?: number;
  renderExtra?: ({
    hovered,
    view,
  }: {
    hovered: boolean;
    view: View
  }) => React.ReactNode;
  expandIds: string[];
  toggleExpand: (id: string, isExpand: boolean) => void;
  onClickView?: (viewId: string) => void;
}) {
  const { t } = useTranslation();
  const selectedViewId = useAppViewId();
  const viewId = view.view_id;
  const selected = selectedViewId === viewId;
  const { updatePage, uploadFile } = useAppHandlers();

  const isExpanded = expandIds.includes(viewId);
  const [hovered, setHovered] = React.useState<boolean>(false);
  const [iconPopoverAnchorEl, setIconPopoverAnchorEl] = React.useState<HTMLDivElement | null>(null);
  const openIconPopover = Boolean(iconPopoverAnchorEl);

  const getIcon = useCallback(() => {
    return <span className={'text-sm h-full flex items-center justify-end w-5'}><OutlineIcon
      level={level}
      isExpanded={isExpanded}
      setIsExpanded={(status) => {
        toggleExpand(viewId, status);
      }}
    /></span>;
  }, [isExpanded, level, toggleExpand, viewId]);

  const onUploadFile = useCallback(async(file: File) => {
    if(!uploadFile) return Promise.reject();
    return uploadFile(viewId, file);
  }, [uploadFile, viewId]);

  const renderItem = useMemo(() => {
    if(!view) return null;

    return (
      <div
        style={{
          backgroundColor: selected ? 'var(--fill-list-hover)' : undefined,
          cursor: 'pointer',
          paddingLeft: view.children?.length ? ((level * 16) + 'px') : ((level * 16) + 24) + 'px',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
        onClick={() => {
          onClickView?.(viewId);
        }}
        className={
          'flex items-center my-[1px] select-none overflow-hidden cursor-pointer min-h-[30px] w-full gap-1 rounded-[8px] py-0.5 px-0.5 text-sm hover:bg-fill-list-hover focus:outline-none'
        }
      >
        {view.children?.length ? getIcon() : null}
        <div
          onClick={e => {
            e.stopPropagation();
            setIconPopoverAnchorEl(e.currentTarget);
          }}
        >
          <PageIcon
            view={view}
            className={'text-text-caption w-5 h-5 mr-1 max-md:text-[20px] flex items-center justify-center'}
          />

        </div>
        <Tooltip
          title={view.layout === ViewLayout.AIChat ? 'View the chat history in app' : view.name}
          disableInteractive={true}
        >
          <div
            className={'flex flex-1 overflow-hidden items-center gap-1 text-sm'}
          >
            <div className={'w-full truncate'}>{view.name.trim() || t('menuAppHeader.defaultNewPageName')}</div>
          </div>
        </Tooltip>
        {renderExtra && renderExtra({ hovered, view })}
      </div>
    );
  }, [view, selected, level, getIcon, t, renderExtra, hovered, onClickView, viewId]);

  const renderChildren = useMemo(() => {
    return <div
      className={'flex transform overflow-hidden w-full flex-col transition-all'}
      style={{
        display: isExpanded ? 'block' : 'none',
      }}
    >{
      view?.children?.map((child) => (
        <ViewItem
          level={level + 1}
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
  }, [toggleExpand, onClickView, isExpanded, expandIds, level, renderExtra, view?.children, width]);

  const handleChangeIcon = useCallback(async(icon: { ty: ViewIconType, value: string }) => {

    try {
      await updatePage?.(view.view_id, {
        icon: icon,
        name: view.name,
        extra: view.extra || {},
      });
      setIconPopoverAnchorEl(null);

      // eslint-disable-next-line
    } catch(e: any) {
      notify.error(e);
    }
  }, [updatePage, view.extra, view.name, view.view_id]);

  const handleRemoveIcon = useCallback(() => {
    void handleChangeIcon({ ty: 0, value: '' });
  }, [handleChangeIcon]);

  return (
    <div
      style={{
        width,
      }}
      className={'flex overflow-hidden h-fit flex-col'}
    >
      {renderItem}
      {renderChildren}
      <Suspense fallback={null}>
        <ChangeIconPopover
          iconEnabled={true}
          defaultType={'emoji'}
          open={openIconPopover}
          anchorEl={iconPopoverAnchorEl}
          onClose={() => {
            setIconPopoverAnchorEl(null);
          }}
          uploadEnabled
          onUploadFile={onUploadFile}
          popoverProps={popoverProps}
          onSelectIcon={(icon) => {
            if(icon.ty === ViewIconType.Icon) {
              void handleChangeIcon({
                ty: ViewIconType.Icon,
                value: JSON.stringify({
                  color: icon.color,
                  groupName: icon.value.split('/')[0],
                  iconName: icon.value.split('/')[1],
                }),
              });
              return;
            }

            void handleChangeIcon(icon);
          }}
          removeIcon={handleRemoveIcon}
        />
      </Suspense>
    </div>
  );
}

export default ViewItem;