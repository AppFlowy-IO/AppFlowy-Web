import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { WorkspaceService } from '@/application/services/domains';
import { useCurrentWorkspaceId } from '@/components/app/app.hooks';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

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
    <>
      <Dialog open={open} onOpenChange={openOnChange}>
        <DialogContent
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              void handleOk();
            }
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('workspace.leaveWorkspace', { workspaceName })}</DialogTitle>
          </DialogHeader>
          <DialogDescription>{t('workspace.leaveWorkspacePrompt', { workspaceName })}</DialogDescription>
          <DialogFooter>
            <Button variant='outline' onClick={() => openOnChange(false)}>
              {t('button.cancel')}
            </Button>
            <Button variant='destructive' loading={loading} onClick={handleOk}>
              {t('button.yes')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export default LeaveWorkspace;
