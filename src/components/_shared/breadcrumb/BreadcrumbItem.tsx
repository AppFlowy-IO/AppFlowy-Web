import { Tooltip } from '@mui/material';
import { useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { useSearchParams } from 'react-router-dom';

import { UIVariant, View } from '@/application/types';
import { notify } from '@/components/_shared/notify';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import PublishIcon from '@/components/_shared/view-icon/PublishIcon';
import SpaceIcon from '@/components/_shared/view-icon/SpaceIcon';

function BreadcrumbItem({
  crumb,
  disableClick = false,
  toView,
  variant,
}: {
  crumb: View;
  disableClick?: boolean;
  toView?: (viewId: string) => Promise<void>;
  variant?: UIVariant;
}) {
  const { view_id, name, extra, is_published } = crumb;

  const { t } = useTranslation();

  const className = useMemo(() => {
    const classList = ['flex', 'items-center', 'gap-1.5', 'text-sm', 'overflow-hidden', 'max-sm:text-base'];

    if (!disableClick && !extra?.is_space) {
      if ((is_published && variant === 'publish') || variant === 'app') {
        classList.push('cursor-pointer hover:text-text-primary hover:underline');
      } else {
        classList.push('flex-1');
      }
    }

    return classList.join(' ');
  }, [disableClick, extra?.is_space, is_published, variant]);

  const [search] = useSearchParams();

  return (
    <div
      data-testid={`breadcrumb-item-${name?.toLowerCase().replace(/\s+/g, '-')}`}
      className={className}
      onClick={async () => {
        if (disableClick || extra?.is_space || (!is_published && variant === 'publish')) return;
        const subviewId = search.get('v');

        try {
          await toView?.(subviewId || view_id);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } catch (e: any) {
          notify.error(e.message);
        }
      }}
    >
      {extra && extra.is_space ? (
        <SpaceIcon
          className={'!h-5 !w-5'}
          bgColor={extra.space_icon_color}
          value={extra.space_icon || ''}
          char={extra.space_icon ? undefined : name.slice(0, 1)}
        />
      ) : (
        <PageIcon view={crumb} className={'!max-md:text-[20px] flex h-5 w-5 min-w-5 items-center justify-center'} />
      )}
      <Tooltip title={name} placement={'bottom'} enterDelay={1000} enterNextDelay={1000}>
        <span className={'min-w-[2.5rem] max-w-[250px] flex-1 overflow-hidden truncate '}>
          {name || t('menuAppHeader.defaultNewPageName')}
        </span>
      </Tooltip>
      {!(extra?.database_id && !extra?.is_database_container) && <PublishIcon variant={variant} view={crumb} />}
    </div>
  );
}

export default BreadcrumbItem;
