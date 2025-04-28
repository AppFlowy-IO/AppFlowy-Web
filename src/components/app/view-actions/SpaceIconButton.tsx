import { CustomIconPopover } from '@/components/_shared/cutsom-icon';
import SpaceIcon from '@/components/_shared/view-icon/SpaceIcon';
import { Avatar } from '@mui/material';
import React from 'react';
import { ReactComponent as EditIcon } from '@/assets/icons/edit.svg';

function SpaceIconButton ({
  spaceIcon,
  spaceIconColor,
  spaceName,
  onSelectSpaceIcon,
  onSelectSpaceIconColor,
  size,
  container,
}: {
  spaceIconColor?: string;
  spaceIcon?: string;
  spaceName: string;
  onSelectSpaceIcon: (icon: string) => void;
  onSelectSpaceIconColor: (color: string) => void;
  size?: number;
  container: HTMLDivElement;
}) {
  const [spaceIconEditing, setSpaceIconEditing] = React.useState<boolean>(false);

  return (
    <CustomIconPopover
      onSelectIcon={({ value, color }) => {
        onSelectSpaceIcon(value);
        onSelectSpaceIconColor(color || '');
      }}
      removeIcon={() => {
        onSelectSpaceIcon('');
        onSelectSpaceIconColor('');
      }}
      defaultActiveTab={'icon'}
      tabs={['icon']}
      popoverContentProps={{ container }}
    >
      <Avatar
        variant={'rounded'}
        className={`${size ? `w-[${size}px] h-[${size}px]` : 'w-10 h-10'} rounded-[30%] bg-transparent`}
        onMouseEnter={() => setSpaceIconEditing(true)}
        onMouseLeave={() => setSpaceIconEditing(false)}
        onClick={() => {
          setSpaceIconEditing(false);
        }}
      >
        <SpaceIcon
          bgColor={spaceIconColor}
          value={spaceIcon || ''}
          className={'w-full h-full p-0.5'}
          char={spaceIcon ? undefined : spaceName.slice(0, 1)}
        />
        {spaceIconEditing &&
          <div className={'absolute cursor-pointer inset-0 bg-black bg-opacity-30 rounded-[8px]'}>
            <div className={'flex items-center text-white justify-center w-full h-full'}>
              <EditIcon />
            </div>
          </div>
        }
      </Avatar>
    </CustomIconPopover>
  );
}

export default SpaceIconButton;