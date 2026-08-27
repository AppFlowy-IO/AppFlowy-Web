import { Button, Divider } from '@mui/material';
import React from 'react';
import { useTranslation } from 'react-i18next';

import { SpaceVisibility } from '@/application/types';
import { ReactComponent as ArrowDownIcon } from '@/assets/icons/alt_arrow_down.svg';
import { ReactComponent as LockIcon } from '@/assets/icons/lock.svg';
import { ReactComponent as PublicIcon } from '@/assets/icons/public.svg';
import { ReactComponent as SettingsIcon } from '@/assets/icons/settings.svg';
import { ReactComponent as TickIcon } from '@/assets/icons/tick.svg';
import { Popover } from '@/components/_shared/popover';
import {
  SELECTABLE_SPACE_VISIBILITIES,
  spaceVisibilityDescription,
  spaceVisibilityLabel,
} from '@/components/app/view-actions/spaceVisibilityOptions';

function visibilityIcon(visibility: SpaceVisibility) {
  switch (visibility) {
    case SpaceVisibility.Private:
      return LockIcon;
    case SpaceVisibility.Custom:
      return SettingsIcon;
    case SpaceVisibility.Public:
    default:
      return PublicIcon;
  }
}

function SpacePermissionButton({
  onSelected,
  value,
}: {
  value: SpaceVisibility;
  onSelected?: (permission: SpaceVisibility) => void;
}) {
  const [anchorEl, setAnchorEl] = React.useState<null | HTMLElement>(null);
  const { t } = useTranslation();
  const SelectedIcon = visibilityIcon(value);

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
          <div className={'font-normal text-text-primary'}>{spaceVisibilityLabel(value, t)}</div>
          <div className={'text-text-secondary'}>{spaceVisibilityDescription(value, t)}</div>
        </div>
      </Button>
      <Popover open={Boolean(anchorEl)} anchorEl={anchorEl} onClose={() => setAnchorEl(null)}>
        <div
          style={{
            width: anchorEl?.clientWidth,
          }}
          className={'flex flex-col gap-2 p-2'}
        >
          {SELECTABLE_SPACE_VISIBILITIES.map((option, index) => {
            const OptionIcon = visibilityIcon(option);
            const selected = option === value;

            return (
              <React.Fragment key={option}>
                <Button
                  data-testid={`space-visibility-option-${option}`}
                  data-selected={selected ? 'true' : 'false'}
                  aria-pressed={selected}
                  className={
                    selected
                      ? 'justify-start gap-2 rounded-300 border border-border-theme-thick bg-fill-theme-select px-4'
                      : 'justify-start gap-2 rounded-300 border border-transparent px-4'
                  }
                  startIcon={<OptionIcon />}
                  color={'inherit'}
                  onClick={() => {
                    onSelected?.(option);
                    setAnchorEl(null);
                  }}
                >
                  <div className={'flex w-full flex-col items-start'}>
                    <div className={'text-base font-normal'}>{spaceVisibilityLabel(option, t)}</div>
                    <div className={'text-left text-text-secondary'}>{spaceVisibilityDescription(option, t)}</div>
                  </div>
                  {selected && <TickIcon className={'h-6 w-6 text-function-success'} />}
                </Button>
                {index < SELECTABLE_SPACE_VISIBILITIES.length - 1 && <Divider />}
              </React.Fragment>
            );
          })}
        </div>
      </Popover>
    </>
  );
}

export default SpacePermissionButton;
