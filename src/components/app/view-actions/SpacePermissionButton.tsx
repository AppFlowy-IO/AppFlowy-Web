import { Button, Divider } from '@mui/material';
import type { TFunction } from 'i18next';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { SpaceVisibility } from '@/application/types';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as LockIcon } from '@/assets/icons/lock.svg';
import { ReactComponent as PublicIcon } from '@/assets/icons/public.svg';
import { ReactComponent as TickIcon } from '@/assets/icons/tick.svg';
import { Popover } from '@/components/_shared/popover';
import {
  SELECTABLE_SPACE_VISIBILITIES,
  SELECTABLE_SPACE_VISIBILITIES_WITHOUT_DEFAULT,
} from '@/components/app/view-actions/spaceVisibilityOptions';

function isRestrictedVisibility(visibility: SpaceVisibility) {
  return visibility === SpaceVisibility.Closed || visibility === SpaceVisibility.Private;
}

function visibilityLabel(visibility: SpaceVisibility, t: TFunction): string {
  switch (visibility) {
    case SpaceVisibility.Default:
      return t('space.permissionManager.default');
    case SpaceVisibility.Closed:
      return t('space.permissionManager.closed');
    case SpaceVisibility.Private:
      return t('space.privatePermission');
    case SpaceVisibility.Open:
    default:
      return t('space.permissionManager.open');
  }
}

function visibilityDescription(visibility: SpaceVisibility, t: TFunction): string {
  switch (visibility) {
    case SpaceVisibility.Default:
      return t('space.permissionManager.defaultVisibilityDescription');
    case SpaceVisibility.Closed:
      return t('space.permissionManager.closedVisibilityDescription');
    case SpaceVisibility.Private:
      return t('space.permissionManager.privateVisibilityDescription');
    case SpaceVisibility.Open:
    default:
      return t('space.permissionManager.openVisibilityDescription');
  }
}

function SpacePermissionButton({
  onSelected,
  value,
  allowDefault = true,
}: {
  value: SpaceVisibility;
  onSelected?: (permission: SpaceVisibility) => void;
  allowDefault?: boolean;
}) {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const { t } = useTranslation();
  const SelectedIcon = isRestrictedVisibility(value) ? LockIcon : PublicIcon;
  const visibilityOptions = allowDefault ? SELECTABLE_SPACE_VISIBILITIES : SELECTABLE_SPACE_VISIBILITIES_WITHOUT_DEFAULT;

  return (
    <>
      <Button
        data-testid='space-visibility-button'
        size={'large'}
        className={'justify-start gap-4 py-3'}
        startIcon={<SelectedIcon />}
        endIcon={<ArrowDownIcon />}
        color={'inherit'}
        variant={'outlined'}
        onClick={(e) => setAnchorEl(e.currentTarget)}
      >
        <div className={'flex w-full flex-col items-start'}>
          <div className={'font-normal text-text-primary'}>{visibilityLabel(value, t)}</div>
          <div className={'text-text-secondary'}>{visibilityDescription(value, t)}</div>
        </div>
      </Button>
      <Popover open={Boolean(anchorEl)} anchorEl={anchorEl} onClose={() => setAnchorEl(null)}>
        <div
          style={{
            width: anchorEl?.clientWidth,
          }}
          className={'flex flex-col gap-2 p-2'}
        >
          {visibilityOptions.map((option, index) => {
            const OptionIcon = isRestrictedVisibility(option) ? LockIcon : PublicIcon;

            return (
              <React.Fragment key={option}>
                <Button
                  data-testid={`space-visibility-option-${option}`}
                  className={'justify-start gap-2 px-4'}
                  startIcon={<OptionIcon />}
                  color={'inherit'}
                  onClick={() => {
                    onSelected?.(option);
                    setAnchorEl(null);
                  }}
                >
                  <div className={'flex w-full flex-col items-start'}>
                    <div className={'text-base font-normal'}>{visibilityLabel(option, t)}</div>
                    <div className={'text-left text-text-secondary'}>{visibilityDescription(option, t)}</div>
                  </div>
                  {option === value && <TickIcon className={'h-6 w-6 text-function-success'} />}
                </Button>
                {index < visibilityOptions.length - 1 && <Divider />}
              </React.Fragment>
            );
          })}
        </div>
      </Popover>
    </>
  );
}

export default SpacePermissionButton;
