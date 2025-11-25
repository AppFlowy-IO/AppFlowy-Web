import { UserWorkspaceInfo, Workspace } from '@/application/types';
import { ReactComponent as AppFlowyLogo } from '@/assets/icons/appflowy.svg';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Progress } from '@/components/ui/progress';

function CurrentWorkspace({
  userWorkspaceInfo,
  selectedWorkspace,
  onChangeWorkspace,
  changeLoading,
  avatarSize = 'xs',
}: {
  userWorkspaceInfo?: UserWorkspaceInfo;
  selectedWorkspace?: Workspace;
  onChangeWorkspace: (selectedId: string) => void;
  avatarSize?: 'xs' | 'sm' | 'md' | 'xl';
  changeLoading?: boolean;
}) {
  if (!userWorkspaceInfo || !selectedWorkspace) {
    return (
      <div
        className={'flex  h-[48px] cursor-pointer items-center gap-1 p-1 text-text-primary'}
        onClick={async () => {
          const selectedId = userWorkspaceInfo?.selectedWorkspace?.id || userWorkspaceInfo?.workspaces[0]?.id;

          if (!selectedId) return;

          void onChangeWorkspace(selectedId);
        }}
      >
        <AppFlowyLogo className='!h-full !w-[118px]' />
      </div>
    );
  }

  return (
    <div className={'flex w-full min-h-[48px] items-center gap-2'}>
      {(
        <Avatar shape={'square'} size={avatarSize}>
          <AvatarImage src={selectedWorkspace.icon} alt={''} />
          <AvatarFallback name={selectedWorkspace.name}>
            {selectedWorkspace.icon ? <span className='text-lg'>{selectedWorkspace.icon}</span> : selectedWorkspace.name}
          </AvatarFallback>
        </Avatar>
      )}

      <div data-testid='current-workspace-name' className={'flex-1 truncate font-medium text-text-primary'}>
        {selectedWorkspace.name}
      </div>
      {changeLoading && <Progress variant={'primary'} />}
    </div>
  );
}

export default CurrentWorkspace;
