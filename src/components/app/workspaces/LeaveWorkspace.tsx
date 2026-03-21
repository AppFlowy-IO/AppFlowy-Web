import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { WorkspaceService } from '@/application/services/domains';
import { NormalModal } from '@/components/_shared/modal';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { HIDDEN_BUTTON_PROPS, MODAL_CLASSES, MODAL_PAPER_PROPS } from '@/components/app/workspaces/modal-props';
import { Button } from '@/components/ui/button';

function LeaveWorkspace({
  workspaceId,
  open,
  openOnChange,
  workspaceName,
}: {
  workspaceId: string;
  open: boolean;
  openOnChange: (open: boolean) => void;
  workspaceName: string;
}) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(false);
  const currentWorkspaceId = useCurrentWorkspaceId();

  const handleOk = async () => {
    try {
      setLoading(true);
      await WorkspaceService.leave(workspaceId);
      openOnChange(false);
      if (currentWorkspaceId === workspaceId) {
        window.location.href = `/app`;
      }
      // eslint-disable-next-line
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <NormalModal
      open={open}
      onClose={() => openOnChange(false)}
      title={
        <div style={{ textAlign: 'left' }}>{t('workspace.leaveWorkspace', { workspaceName })}</div>
      }
      classes={MODAL_CLASSES}
      PaperProps={MODAL_PAPER_PROPS}
      okButtonProps={HIDDEN_BUTTON_PROPS}
      cancelButtonProps={HIDDEN_BUTTON_PROPS}
    >
      <div className='text-text-secondary'>
        {t('workspace.leaveWorkspacePrompt', { workspaceName })}
      </div>
      <div className='flex w-full justify-end gap-3 mt-4'>
        <Button variant='outline' onClick={() => openOnChange(false)}>
          {t('button.cancel')}
        </Button>
        <Button variant='destructive' loading={loading} onClick={() => void handleOk()}>
          {t('button.yes')}
        </Button>
      </div>
    </NormalModal>
  );
}

export default LeaveWorkspace;
