import { View, ViewLayout } from '@/application/types';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { ReactComponent as PlusIcon } from '@/assets/icons/plus.svg';
import { getOutlineExpands, setOutlineExpands } from '@/components/_shared/outline/utils';
import DirectoryStructure from '@/components/_shared/skeleton/DirectoryStructure';
import { useAppHandlers, useAppOutline } from '@/components/app/app.hooks';
import { Favorite } from '@/components/app/favorite';
import SpaceItem from '@/components/app/outline/SpaceItem';
import ViewActionsPopover from '@/components/app/view-actions/ViewActionsPopover';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import React, { useCallback, useState } from 'react';
import { createPortal } from 'react-dom';
import { useTranslation } from 'react-i18next';

export function Outline ({
  width,
}: {
  width: number;
}) {
  const outline = useAppOutline();

  const [menuProps, setMenuProps] = useState<{
    x: number;
    y: number;
    view: View;
    popoverType: {
      category: 'space' | 'page';
      type: 'more' | 'add';
    }
  } | undefined>(undefined);
  const [expandViewIds, setExpandViewIds] = React.useState<string[]>(Object.keys(getOutlineExpands()));
  const toggleExpandView = useCallback((id: string, isExpanded: boolean) => {

    setOutlineExpands(id, isExpanded);
    setExpandViewIds((prev) => {
      return isExpanded ? [...prev, id] : prev.filter((v) => v !== id);
    });
  }, []);
  const { t } = useTranslation();

  const renderActions = useCallback(({ hovered, view }: { hovered: boolean; view: View }) => {
    const isSpace = view?.extra?.is_space;
    const layout = view?.layout;

    const onClick = (e: React.MouseEvent<HTMLButtonElement>, type: 'more' | 'add') => {
      const target = e.currentTarget as HTMLButtonElement;
      const rect = target.getBoundingClientRect();
      const x = rect.left;
      const y = rect.top + rect.height;

      setMenuProps({
        x,
        y,
        view,
        popoverType: {
          type,
          category: isSpace ? 'space' : 'page',
        },
      });
    };

    const shouldHidden = !hovered && menuProps?.view.view_id !== view.view_id;

    if (shouldHidden) return null;

    return <div
      onClick={e => e.stopPropagation()}
      className={'flex items-center px-2'}
    >
      <Tooltip
        disableHoverableContent
        delayDuration={500}
      >
        <TooltipTrigger asChild>
          <Button
            variant={'ghost'}
            size={'icon-sm'}
            onClick={(e) => {
              onClick(e, 'more');
            }}
          >
            <MoreIcon />
          </Button>
        </TooltipTrigger>
        <TooltipContent>
          {isSpace ? t('space.manage') : t('menuAppHeader.moreButtonToolTip')}
        </TooltipContent>
      </Tooltip>
      {layout === ViewLayout.Document ? <Tooltip
        disableHoverableContent
        delayDuration={500}
      >
        <TooltipTrigger asChild>
          <Button
            variant={'ghost'}
            size={'icon-sm'}
            onClick={(e) => {
              onClick(e, 'add');
            }}
          >
            <PlusIcon />
          </Button>
        </TooltipTrigger>

        <TooltipContent>
          {isSpace ? t('sideBar.addAPage') : t('menuAppHeader.addPageTooltip')}
        </TooltipContent>
      </Tooltip> : null}

    </div>;
  }, [menuProps, t]);

  const {
    toView,
  } = useAppHandlers();

  const onClickView = useCallback((viewId: string) => {
    void toView(viewId);
  }, [toView]);

  return (
    <>
      <div className={'flex folder-views w-full flex-1 flex-col pb-[10px] pt-1 px-[8px]'}>
        <Favorite />
        {!outline || outline.length === 0 ? <div
            style={{
              width: width - 20,
            }}
          ><DirectoryStructure />
          </div> :
          outline.map((view) => <SpaceItem
            view={view}
            key={view.view_id}
            width={width - 20}
            renderExtra={renderActions}
            expandIds={expandViewIds}
            toggleExpand={toggleExpandView}
            onClickView={onClickView}
          />)}
      </div>
      {menuProps && createPortal(<ViewActionsPopover
        popoverType={menuProps.popoverType}
        view={menuProps.view}
        open={Boolean(menuProps)}
        onOpenChange={open => {
          if (!open) {
            setMenuProps(undefined);
          }
        }}
      >
        <div
          style={{
            width: '24px',
            height: '5px',
            position: 'absolute',
            pointerEvents: menuProps ? 'auto' : 'none',
            top: menuProps ? menuProps.y : 0,
            left: menuProps ? menuProps.x : 0,
            zIndex: menuProps ? 1 : -1,
          }}
        />
      </ViewActionsPopover>, document.body)}
    </>
  );
}

export default Outline;