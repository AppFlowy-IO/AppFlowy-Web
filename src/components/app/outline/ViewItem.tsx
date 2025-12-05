import React, { useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { View, ViewIconType, ViewLayout } from '@/application/types';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import OutlineIcon from '@/components/_shared/outline/OutlineIcon';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { useAppHandlers, useAppViewId } from '@/components/app/app.hooks';

// Check if a layout is a database view type
function isDatabaseLayout(layout: ViewLayout): boolean {
  return layout === ViewLayout.Grid ||
    layout === ViewLayout.Board ||
    layout === ViewLayout.Calendar;
}

// Check if this is a referenced database view (both view and parent are database views)
function isReferencedDatabaseView(view: View, parentLayout?: ViewLayout): boolean {
  if (parentLayout === undefined) {
    return false;
  }

  return isDatabaseLayout(view.layout) && isDatabaseLayout(parentLayout);
}

function ViewItem({
  view,
  width,
  level = 0,
  renderExtra,
  expandIds,
  toggleExpand,
  onClickView,
  parentLayout,
}: {
  view: View;
  width: number;
  level?: number;
  renderExtra?: ({ hovered, view }: { hovered: boolean; view: View }) => React.ReactNode;
  expandIds: string[];
  toggleExpand: (id: string, isExpand: boolean) => void;
  onClickView?: (viewId: string) => void;
  parentLayout?: ViewLayout;
}) {
  const { t } = useTranslation();
  const selectedViewId = useAppViewId();
  const viewId = view.view_id;
  const selected = selectedViewId === viewId;
  const { updatePage, uploadFile } = useAppHandlers();

  const isExpanded = expandIds.includes(viewId);
  const [hovered, setHovered] = React.useState<boolean>(false);

  const handleChangeIcon = useCallback(
    async (icon: { ty: ViewIconType; value: string }) => {
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
    },
    [updatePage, view.extra, view.name, view.view_id]
  );

  const handleRemoveIcon = useCallback(() => {
    void handleChangeIcon({ ty: 0, value: '' });
  }, [handleChangeIcon]);

  const getIcon = useCallback(() => {
    return (
      <span className={'flex h-full w-5 items-center justify-end text-sm'}>
        <OutlineIcon
          level={level}
          isExpanded={isExpanded}
          setIsExpanded={(status) => {
            toggleExpand(viewId, status);
          }}
        />
      </span>
    );
  }, [isExpanded, level, toggleExpand, viewId]);

  // Dot icon for referenced database views (like desktop)
  const getDotIcon = useCallback(() => {
    return (
      <span className={'flex h-full w-2 items-center justify-center text-sm'}>
        <span className={'h-1 w-1 rounded-full bg-text-caption'} />
      </span>
    );
  }, []);

  const onUploadFile = useCallback(
    async (file: File) => {
      if (!uploadFile) return Promise.reject();
      return uploadFile(viewId, file);
    },
    [uploadFile, viewId]
  );

  const renderItem = useMemo(() => {
    if (!view) return null;

    // Determine which left icon to show
    const isRefDatabaseView = isReferencedDatabaseView(view, parentLayout);
    const hasChildren = Boolean(view.children?.length);

    // Calculate left padding based on icon presence
    const showLeftIcon = isRefDatabaseView || hasChildren;
    const leftPadding = showLeftIcon ? level * 16 : level * 16 + 24;

    // Render left icon: dot for referenced database views, expand icon for views with children
    const renderLeftIcon = () => {
      if (isRefDatabaseView) {
        return getDotIcon();
      }

      if (hasChildren) {
        return getIcon();
      }

      return null;
    };

    return (
      <div
        data-testid={`page-${view.view_id}`}
        style={{
          backgroundColor: selected ? 'var(--fill-content-hover)' : undefined,
          cursor: 'pointer',
          paddingLeft: leftPadding + 'px',
        }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => {
          setHovered(false);
        }}
        onClick={() => {
          onClickView?.(viewId);
        }}
        className={
          'my-[1px] flex min-h-[30px] w-full cursor-pointer select-none items-center gap-1 overflow-hidden rounded-[8px] px-0.5 py-0.5 text-sm hover:bg-fill-content-hover focus:outline-none'
        }
      >
        {renderLeftIcon()}

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
            data-testid='page-icon'
            onClick={(e) => {
              e.stopPropagation();
            }}
          >
            <PageIcon
              view={view}
              className={'mr-1 flex h-5 w-5 items-center justify-center text-base text-text-secondary'}
            />
          </div>
        </CustomIconPopover>

        <div className={'flex flex-1 items-center gap-1 overflow-hidden text-sm'}>
          <div data-testid='page-name' className={'w-full truncate'}>
            {view.name.trim() || t('menuAppHeader.defaultNewPageName')}
          </div>
        </div>
        {renderExtra && renderExtra({ hovered, view })}
      </div>
    );
  }, [
    view,
    selected,
    level,
    getIcon,
    getDotIcon,
    parentLayout,
    onUploadFile,
    handleRemoveIcon,
    t,
    renderExtra,
    hovered,
    onClickView,
    viewId,
    handleChangeIcon,
  ]);

  const renderChildren = useMemo(() => {
    // Don't pass renderExtra (more button) to children when parent is a database layout
    const parentIsDatabaseLayout = isDatabaseLayout(view.layout);
    const childRenderExtra = parentIsDatabaseLayout ? undefined : renderExtra;

    return (
      <div
        className={'flex w-full transform flex-col overflow-hidden transition-all'}
        style={{
          display: isExpanded ? 'block' : 'none',
        }}
      >
        {view?.children?.map((child) => (
          <ViewItem
            level={level + 1}
            key={child.view_id}
            view={child}
            width={width}
            renderExtra={childRenderExtra}
            expandIds={expandIds}
            toggleExpand={toggleExpand}
            onClickView={onClickView}
            parentLayout={view.layout}
          />
        ))}
      </div>
    );
  }, [toggleExpand, onClickView, isExpanded, expandIds, level, renderExtra, view?.children, view.layout, width]);

  return (
    <div
      style={{
        width,
      }}
      className={'flex h-fit flex-col overflow-hidden'}
      data-testid='page-item'
    >
      {renderItem}
      {renderChildren}
    </div>
  );
}

export default ViewItem;
