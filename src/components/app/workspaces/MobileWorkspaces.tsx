import { Divider, IconButton } from '@mui/material';
import React, { useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { MobileDrawer } from '@/components/_shared/mobile-drawer';
import { notify } from '@/components/_shared/notify';
import { useAppHandlers, useCurrentWorkspaceId, useUserWorkspaceInfo } from '@/components/app/app.hooks';
import CurrentWorkspace from '@/components/app/workspaces/CurrentWorkspace';
import WorkspaceList from '@/components/app/workspaces/WorkspaceList';
import { useCurrentUser } from '@/components/main/app.hooks';

function MobileWorkspaces({ onClose }: { onClose: () => void }) {
  const [open, setOpen] = React.useState(false);
  const { t } = useTranslation();
  const userWorkspaceInfo = useUserWorkspaceInfo();
  const currentWorkspaceId = useCurrentWorkspaceId();
  const currentUser = useCurrentUser();
  const [changeLoading, setChangeLoading] = React.useState<string | null>(null);
  const { onChangeWorkspace: handleSelectedWorkspace } = useAppHandlers();
  const selectedWorkspace = useMemo(() => {
    return userWorkspaceInfo?.workspaces.find((workspace) => workspace.id === currentWorkspaceId);
  }, [currentWorkspaceId, userWorkspaceInfo]);

  const handleOpen = () => {
    setOpen(true);
  };

  const handleClose = useCallback(() => {
    setOpen(false);
  }, []);

  const handleChange = useCallback(
    async (selectedId: string) => {
      setChangeLoading(selectedId);
      try {
        await handleSelectedWorkspace?.(selectedId);
      } catch (e) {
        notify.error('Failed to change workspace');
      }

      onClose();
      handleClose();
      setChangeLoading(null);
    },
    [handleClose, handleSelectedWorkspace, onClose]
  );

  const triggerNode = useMemo(() => {
    return (
      <div>
        <CurrentWorkspace
          userWorkspaceInfo={userWorkspaceInfo}
          selectedWorkspace={selectedWorkspace}
          onChangeWorkspace={handleChange}
        />
      </div>
    );
  }, [handleChange, selectedWorkspace, userWorkspaceInfo]);

  const ref = useRef<HTMLDivElement>(null);

  return (
    <MobileDrawer
      maxHeight={window.innerHeight - 56}
      onOpen={handleOpen}
      onClose={handleClose}
      open={open}
      anchor={'bottom'}
      triggerNode={triggerNode}
    >
      <div
        ref={ref}
        className={'appflowy-scroller flex w-full flex-col gap-2  overflow-y-auto overflow-x-hidden pb-[60px]'}
      >
        <div className={'sticky top-0 z-[10] flex flex-col bg-background-primary pt-10'}>
          <div className={'relative p-4'}>
            <IconButton color={'inherit'} className={'absolute left-4 h-6 w-6 font-semibold'} onClick={handleClose}>
              <CloseIcon className={'h-4 w-4'} />
            </IconButton>
            <div className={'w-full text-center font-medium '}>{t('workspace.menuTitle')}</div>
          </div>
          <div className={'underline-none flex-1 p-4 text-base font-medium text-text-secondary'}>
            {currentUser?.email}
          </div>
          <Divider className={'w-full'} />
        </div>

        <div
          onTouchMove={(e) => {
            const el = ref.current as HTMLDivElement;

            if (!el) return;
            if (el.scrollHeight > el.clientHeight) {
              e.stopPropagation();
            }
          }}
          className={'flex flex-col gap-4 p-2 text-lg'}
        >
          {open && (
            <WorkspaceList
              defaultWorkspaces={userWorkspaceInfo?.workspaces}
              currentWorkspaceId={currentWorkspaceId}
              onChange={handleChange}
              changeLoading={changeLoading || undefined}
              showActions={false}
              useDropdownItem={false}
            />
          )}
        </div>
        <Divider className={'w-full'} />
      </div>
    </MobileDrawer>
  );
}

export default MobileWorkspaces;
