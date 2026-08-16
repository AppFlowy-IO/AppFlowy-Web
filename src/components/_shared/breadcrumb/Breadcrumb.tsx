import { IconButton } from '@mui/material';
import { memo, useMemo, useState } from 'react';

import { UIVariant, View } from '@/application/types';
import { ReactComponent as RightIcon } from '@/assets/icons/alt_arrow_right.svg';
import { ReactComponent as MoreIcon } from '@/assets/icons/more.svg';
import BreadcrumbItem from '@/components/_shared/breadcrumb/BreadcrumbItem';
import BreadcrumbMoreModal from '@/components/_shared/breadcrumb/BreadcrumbMoreModal';
import { getPlatform } from '@/utils/platform';

export interface BreadcrumbProps {
  crumbs: View[];
  toView?: (viewId: string) => Promise<void>;
  variant?: UIVariant;
}

export function Breadcrumb({ crumbs, toView, variant }: BreadcrumbProps) {
  const [openMore, setOpenMore] = useState(false);
  const renderCrumb = useMemo(() => {
    const tailCount = getPlatform().isMobile ? 1 : 2;

    if (crumbs.length > tailCount + 1) {
      const firstCrumb = crumbs[0];
      const lastCrumbs = crumbs.slice(-tailCount);

      return (
        <>
          {firstCrumb.extra?.is_hidden_space ? null : (
            <div className={'flex min-w-0 items-center gap-2 truncate text-text-primary'}>
              <BreadcrumbItem variant={variant} toView={toView} crumb={firstCrumb} disableClick={true} />
              <RightIcon className={'h-5 w-5 shrink-0'} />
            </div>
          )}
          <div className={'flex min-w-0 shrink-0 items-center gap-2 truncate text-text-primary'}>
            <IconButton
              onClick={() => {
                setOpenMore(true);
              }}
            >
              <MoreIcon className={'h-5 w-5 shrink-0'} />
            </IconButton>

            <RightIcon className={'h-5 w-5 shrink-0'} />
          </div>
          {lastCrumbs.map((crumb, index) => {
            const key = `${crumb.view_id}-${index}`;

            return (
              <div className={'flex min-w-0 items-center gap-2 truncate text-text-primary'} key={key}>
                <BreadcrumbItem
                  variant={variant}
                  toView={toView}
                  crumb={crumb}
                  disableClick={index === lastCrumbs.length - 1}
                />
                {index === lastCrumbs.length - 1 ? null : <RightIcon className={'h-5 w-5 shrink-0'} />}
              </div>
            );
          })}
        </>
      );
    }

    return crumbs?.map((crumb, index) => {
      const isLast = index === crumbs.length - 1;
      const key = `${crumb.view_id}-${index}`;

      if (crumb.extra?.is_hidden_space) {
        return null;
      }

      return (
        <div
          className={`${isLast ? 'text-text-primary' : 'text-text-secondary'} flex min-w-0 items-center gap-2 truncate`}
          key={key}
        >
          <BreadcrumbItem toView={toView} crumb={crumb} disableClick={isLast} variant={variant} />
          {!isLast && <RightIcon className={'h-5 w-5 shrink-0'} />}
        </div>
      );
    });
  }, [crumbs, toView, variant]);

  return (
    <div
      data-testid='breadcrumb-navigation'
      className={'relative flex h-full w-full flex-1 items-center gap-2 overflow-hidden'}
    >
      {renderCrumb}
      <BreadcrumbMoreModal
        open={openMore}
        onClose={() => setOpenMore(false)}
        crumbs={crumbs}
        toView={toView}
        variant={variant}
      />
    </div>
  );
}

export default memo(Breadcrumb);
