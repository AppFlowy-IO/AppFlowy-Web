import { Tooltip } from '@mui/material';
import React, { memo } from 'react';
import { useTranslation } from 'react-i18next';

import { UIVariant, View } from '@/application/types';
import { getFirstChildView, isDatabaseContainer, isReferencedDatabaseView } from '@/application/view-utils';
import PageIcon from '@/components/_shared/view-icon/PageIcon';
import PublishIcon from '@/components/_shared/view-icon/PublishIcon';
import SpaceIcon from '@/components/_shared/view-icon/SpaceIcon';

function OutlineItemContent({
  item,
  setIsExpanded,
  navigateToView,
  level,
  variant,
  parentView,
}: {
  item: View;
  setIsExpanded: React.Dispatch<React.SetStateAction<boolean>>;
  navigateToView?: (viewId: string) => Promise<void>;
  level: number;
  variant?: UIVariant;
  parentView?: View;
}) {
  const { name, view_id, extra } = item;
  const [hovered, setHovered] = React.useState(false);
  const isSpace = extra?.is_space;
  const isDatabaseView = extra?.database_id && !extra?.is_database_container;
  const isDatabaseContainerView = isDatabaseContainer(item);
  const isPublishedDatabaseView = variant === UIVariant.Publish && isReferencedDatabaseView(item, parentView);
  const { t } = useTranslation();

  return (
    <div
      onClick={async() => {

        if (
          isSpace ||
          (!item.is_published && variant === UIVariant.Publish && !isDatabaseView && !isDatabaseContainerView)
        ) {
          setIsExpanded(prev => !prev);
          return;
        }

        try {
          const targetViewId =
            variant === UIVariant.Publish ? getFirstChildView(item)?.view_id || view_id : view_id;

          await navigateToView?.(targetViewId);
        } catch(e) {
          // do nothing
        }
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        paddingLeft: variant === 'favorite' || variant === 'recent' ? '8px' : item.children?.length ? 0 : 1.125 * (level + 1) + 'em',
      }}
      className={`flex flex-1 select-none items-center pointer gap-1.5 overflow-hidden`}
    >
      {isSpace && extra ? (
        <SpaceIcon
          bgColor={extra.space_icon_color}
          value={extra.space_icon || ''}
          char={extra.space_icon ? undefined : name.slice(0, 1)}
        />
      ) : isPublishedDatabaseView ? (
        <span data-testid='database-view-dot' className={'flex h-full w-5 min-w-5 items-center justify-end'}>
          <span className={'p-1.5'}>
            <span className={'block h-1 w-1 rounded-full bg-text-secondary'} />
          </span>
        </span>
      ) : (
        <PageIcon
          view={item}
          iconSize={20}
          className={'flex !w-5 !h-5 min-w-5 text-sm items-center justify-center'}
        />
      )}

      <Tooltip
        title={name}
        disableInteractive={true}
      >
        <div data-testid={isSpace ? 'space-name' : 'page-name'} className={'flex-1 truncate'}>{name || t('menuAppHeader.defaultNewPageName')}</div>
      </Tooltip>
      {hovered && variant === UIVariant.Publish && !isDatabaseView && <PublishIcon
        variant={variant}
        view={item}
      />}
    </div>
  );
}

export default memo(OutlineItemContent);
