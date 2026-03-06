import { IconButton, Paper, Tooltip } from '@mui/material';
import { useCallback, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { View } from '@/application/types';
import { ReactComponent as PrivateIcon } from '@/assets/icons/lock.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import { findAncestors } from '@/components/_shared/outline/utils';
import { RichTooltip } from '@/components/_shared/popover';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import { useAppOutline, useToView } from '@/components/app/app.hooks';

function ListItem({
  selectedView,
  view,
  onClick,
  onClose,
}: {
  selectedView: string;
  view: View;
  onClick: () => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const outline = useAppOutline();
  const [open, setOpen] = useState<boolean>(false);
  const toView = useToView();

  const ancestors = useMemo(() => {
    if (!outline) return [];
    return findAncestors(outline, view.view_id)?.slice(0, -1) || [];
  }, [outline, view.view_id]);

  const renderBreadcrumb = useCallback(
    (view: View) => {
      const isPrivate = view.is_private && view.extra?.is_space;

      return (
        <Tooltip enterDelay={700} disableInteractive={true} title={view.name}>
          <div
            style={{
              cursor: view.extra?.is_space ? 'default' : 'pointer',
            }}
            onClick={(e) => {
              e.stopPropagation();
              if (view.extra?.is_space) return;
              void toView(view.view_id);
              onClose();
            }}
            className={`max-w-[250px] overflow-hidden text-text-secondary ${
              view.extra?.is_space ? '' : 'hover:underline'
            } flex items-center gap-1`}
          >
            <span className={'truncate'}>{view.name || t('menuAppHeader.defaultNewPageName')}</span>
            {isPrivate && (
              <div className={'min-h-5 min-w-5 text-base text-text-primary opacity-80'}>
                <PrivateIcon className='h-5 w-5' />
              </div>
            )}
          </div>
        </Tooltip>
      );
    },
    [onClose, t, toView]
  );

  const breadcrumbs = useMemo(() => {
    if (!ancestors) return null;
    if (ancestors.length <= 3) {
      return ancestors.map((ancestor, index) => {
        return (
          <div key={ancestor.view_id} className={'flex items-center gap-2'}>
            {renderBreadcrumb(ancestor)}
            {index !== ancestors.length - 1 && <span>{'/'}</span>}
          </div>
        );
      });
    }

    const first = renderBreadcrumb(ancestors[0]);
    const last = renderBreadcrumb(ancestors[ancestors.length - 1]);

    return (
      <>
        {first}
        <div className={'flex items-center gap-2'}>
          <span>{'/'}</span>
          <RichTooltip
            open={open}
            placement='bottom'
            onClose={() => setOpen(false)}
            content={
              <Paper className={'p-1'}>
                {ancestors.slice(1, -1).map((ancestor) => {
                  return (
                    <div key={ancestor.view_id} className={'flex w-full items-center gap-2 p-1.5'}>
                      {renderBreadcrumb(ancestor)}
                    </div>
                  );
                })}
              </Paper>
            }
          >
            <IconButton
              onClick={(e) => {
                e.stopPropagation();
                setOpen((prev) => !prev);
              }}
              size={'small'}
            >
              <MoreIcon />
            </IconButton>
          </RichTooltip>
          <span>{'/'}</span>
          {last}
        </div>
      </>
    );
  }, [ancestors, open, renderBreadcrumb]);

  return (
    <div
      data-item-id={view.view_id}
      style={{
        backgroundColor: selectedView === view.view_id ? 'var(--fill-list-active)' : undefined,
      }}
      onClick={onClick}
      className={'flex w-full cursor-pointer flex-col gap-1 px-4 py-2 hover:bg-fill-list-active'}
    >
      <div className={'flex items-center gap-3'}>
        <div className={'flex h-7 w-7 items-center justify-center rounded border border-line-border'}>
          <PageIcon view={view} className={'flex h-5 w-5 items-center justify-center'} />
        </div>
        <div className={'flex-1 truncate text-base font-medium'}>
          {view.name.trim() || t('menuAppHeader.defaultNewPageName')}
        </div>
      </div>

      <div className={'ml-10'}>
        <div className={'flex w-full items-center gap-2 overflow-hidden text-sm text-text-secondary'}>{breadcrumbs}</div>
      </div>
    </div>
  );
}

export default ListItem;
