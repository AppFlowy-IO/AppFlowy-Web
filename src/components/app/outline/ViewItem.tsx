import { View, ViewIconType } from '@/application/types';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import OutlineIcon from '@/components/_shared/outline/OutlineIcon';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { useAppHandlers, useAppViewId } from '@/components/app/app.hooks';
import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

function ViewItem ({ view, width, level = 0, renderExtra, expandIds, toggleExpand, onClickView }: {
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

  const handleChangeIcon = useCallback(async (icon: { ty: ViewIconType, value: string }) => {
    try {
      await updatePage?.(view.view_id, {
        icon: icon,
        name: view.name,
        extra: view.extra || {},
      });

      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e);
    }
  }, [updatePage, view.extra, view.name, view.view_id]);

  const handleRemoveIcon = useCallback(() => {
    void handleChangeIcon({ ty: 0, value: '' });
  }, [handleChangeIcon]);

  const getIcon = useCallback(() => {
    return <span className={'text-sm h-full flex items-center justify-end w-5'}><OutlineIcon
      level={level}
      isExpanded={isExpanded}
      setIsExpanded={(status) => {
        toggleExpand(viewId, status);
      }}
    /></span>;
  }, [isExpanded, level, toggleExpand, viewId]);

  const onUploadFile = useCallback(async (file: File) => {
    if (!uploadFile) return Promise.reject();
    return uploadFile(viewId, file);
  }, [uploadFile, viewId]);

  const renderItem = useMemo(() => {
    if (!view) return null;

    return (
      <div
        style={{
          backgroundColor: selected ? 'var(--fill-list-hover)' : undefined,
          cursor: 'pointer',
          paddingLeft: view.children?.length ? ((level * 16) + 'px') : ((level * 16) + 24) + 'px',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => {
          setHovered(false);
        }}
        onClick={() => {
          onClickView?.(viewId);
        }}
        className={
          'flex items-center my-[1px] select-none overflow-hidden cursor-pointer min-h-[30px] w-full gap-1 rounded-[8px] py-0.5 px-0.5 text-sm hover:bg-fill-list-hover focus:outline-none'
        }
      >
        {view.children?.length ? getIcon() : null}

        <CustomIconPopover
          defaultActiveTab={view.icon?.ty === 1 ? 'upload' : view.icon?.ty === 2 ? 'icon' : 'emoji'}
          tabs={['emoji', 'icon', 'upload']}
          onUploadFile={onUploadFile}
          onSelectIcon={(icon) => {
            if (icon.ty === ViewIconType.Icon) {
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
        >
          <div
            onClick={e => {
              e.stopPropagation();
            }}
          >
            <PageIcon
              view={view}
              className={'text-text-caption w-5 h-5 mr-1 max-md:text-[20px] flex items-center justify-center'}
            />
          </div>
        </CustomIconPopover>

        <div
          className={'flex flex-1 overflow-hidden items-center gap-1 text-sm'}
        >
          <div className={'w-full truncate'}>{view.name.trim() || t('menuAppHeader.defaultNewPageName')}</div>
        </div>
        {renderExtra && renderExtra({ hovered, view })}
      </div>
    );
  }, [view, selected, level, getIcon, onUploadFile, handleRemoveIcon, t, renderExtra, hovered, onClickView, viewId, handleChangeIcon]);

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

  return (
    <div
      style={{
        width,
      }}
      className={'flex overflow-hidden h-fit flex-col'}
    >
      {renderItem}
      {renderChildren}

    </div>
  );
}

export default ViewItem;