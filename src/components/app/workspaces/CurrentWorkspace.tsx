import { UserWorkspaceInfo, Workspace } from '@/application/types';
import { getAvatarProps } from '@/components/app/workspaces/utils';
import { Avatar } from '@mui/material';
import React from 'react';
import { ReactComponent as AppFlowyLogo } from '@/assets/icons/appflowy.svg';

function CurrentWorkspace({
  userWorkspaceInfo,
  selectedWorkspace,
  onChangeWorkspace,
  avatarSize = 32,
}: {
  userWorkspaceInfo?: UserWorkspaceInfo;
  selectedWorkspace?: Workspace;
  onChangeWorkspace: (selectedId: string) => void;
  avatarSize?: number;
}) {
  if (!userWorkspaceInfo || !selectedWorkspace) {
    return (
      <div
        className={'flex cursor-pointer items-center gap-1 p-2 text-text-title'}
        onClick={async () => {
          const selectedId = userWorkspaceInfo?.selectedWorkspace?.id || userWorkspaceInfo?.workspaces[0]?.id;

          if (!selectedId) return;

          void onChangeWorkspace(selectedId);
        }}
      >
        <AppFlowyLogo className={'w-[88px]'} />
      </div>
    );
  }

  return (
    <div className={'flex items-center gap-1.5'}>
      <Avatar
        variant={'rounded'}
        className={`flex items-center justify-center rounded-[8px] border-none border-line-divider p-1 ${
          selectedWorkspace.icon ? 'bg-transparent' : ''
        }`}
        {...getAvatarProps(selectedWorkspace)}
        style={{
          width: avatarSize,
          height: avatarSize,
          fontSize: avatarSize / 1.2,
        }}
      />
      <div className={'flex-1 truncate font-medium text-text-title'}>{selectedWorkspace.name}</div>
    </div>
  );
}

export default CurrentWorkspace;
