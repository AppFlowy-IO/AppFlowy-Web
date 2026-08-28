import { Avatar } from '@mui/material';
import React from 'react';

import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';
import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import SpaceIcon from '@/components/_shared/view-icon/SpaceIcon';

function SpaceIconButton({
  spaceIcon,
  spaceIconColor,
  spaceName,
  onSelectSpaceIcon,
  onSelectSpaceIconColor,
  onChange,
  size,
  container,
  disabled = false,
}: {
  spaceIconColor?: string;
  spaceIcon?: string;
  spaceName: string;
  onSelectSpaceIcon?: (icon: string) => void;
  onSelectSpaceIconColor?: (color: string) => void;
  onChange?: (icon: string, color: string) => void;
  size?: number;
  container: HTMLDivElement;
  disabled?: boolean;
}) {
  const [spaceIconEditing, setSpaceIconEditing] = React.useState<boolean>(false);

  return (
    <CustomIconPopover
      enable={!disabled}
      onSelectIcon={({ value, color }) => {
        const nextColor = color || '';

        onChange?.(value, nextColor);
        onSelectSpaceIcon?.(value);
        onSelectSpaceIconColor?.(nextColor);
      }}
      removeIcon={() => {
        onChange?.('', '');
        onSelectSpaceIcon?.('');
        onSelectSpaceIconColor?.('');
      }}
      defaultActiveTab={'icon'}
      tabs={['icon']}
      popoverContentProps={{ container }}
    >
      <Avatar
        variant={'rounded'}
        className={`aspect-square h-10 w-10 rounded-[30%] bg-transparent`}
        onMouseEnter={() => {
          if (!disabled) setSpaceIconEditing(true);
        }}
        onMouseLeave={() => setSpaceIconEditing(false)}
        onClick={() => {
          setSpaceIconEditing(false);
        }}
        style={{
          minWidth: size ? `${size}px` : undefined,
          minHeight: size ? `${size}px` : '100%',
        }}
      >
        <SpaceIcon
          bgColor={spaceIconColor}
          value={spaceIcon || ''}
          className={'h-full w-full !p-2'}
          char={spaceIcon ? undefined : spaceName.slice(0, 1)}
        />
        {!disabled && spaceIconEditing && (
          <div className={'absolute inset-0 cursor-pointer rounded-[8px] bg-black bg-opacity-30'}>
            <div className={'flex h-full w-full items-center justify-center text-white'}>
              <EditIcon />
            </div>
          </div>
        )}
      </Avatar>
    </CustomIconPopover>
  );
}

export default SpaceIconButton;
