import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { WorkspaceCreationFlow } from '@/components/app/hooks/useWorkspaceCreationAttempt';
import { WorkspaceCreationCapabilityState } from '@/components/app/hooks/useWorkspaceCreationCapability';
import { Button } from '@/components/ui/button';

import EditWorkspace from './EditWorkspace';
import { WorkspaceCreationCallout, WorkspaceCreationNotice } from './WorkspaceCreationNotice';

/**
 * Create a workspace, or settle a saved request: Check again finishes the same request (it never
 * creates a second workspace), and Discard forgets it. A workspace that was created but not opened
 * offers Open workspace instead of another creation.
 */
export function CreateWorkspaceDialog({
  open,
  onOpenChange,
  creation,
  flow,
  defaultName,
  onDiscarded,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  creation: WorkspaceCreationCapabilityState;
  flow: WorkspaceCreationFlow;
  defaultName?: string;
  /** After Discard, e.g. refresh the workspace list in case the request had succeeded. */
  onDiscarded?: () => void;
}) {
  const { t } = useTranslation();
  const { draft, unreadable } = flow;
  const discard = (close: boolean) => {
    flow.discard();
    onDiscarded?.();
    if (close) onOpenChange(false);
  };

  let notice: ReactNode = <WorkspaceCreationNotice capability={creation} showOwnership />;
  let okText = t('button.create');
  let canSubmit = creation.canCreate;
  let secondaryAction: ReactNode;

  if (unreadable) {
    notice = (
      <WorkspaceCreationCallout tone='warning' role='alert'>
        {t('workspaceCreation.invalidDraft')}
      </WorkspaceCreationCallout>
    );
    canSubmit = false;
    secondaryAction = (
      <Button variant='ghost' onClick={() => discard(false)}>
        {t('workspaceCreation.discard')}
      </Button>
    );
  } else if (draft?.workspaceId) {
    notice = <WorkspaceCreationCallout>{t('workspaceCreation.createdNotOpened')}</WorkspaceCreationCallout>;
    okText = t('workspaceCreation.openWorkspace');
    canSubmit = true;
    secondaryAction = (
      <Button variant='ghost' disabled={flow.submitting} onClick={() => discard(true)}>
        {t('workspaceCreation.dismiss')}
      </Button>
    );
  } else if (draft) {
    notice = (
      <WorkspaceCreationCallout tone='warning'>
        <p>{t('workspaceCreation.notConfirmed')}</p>
        <p className='mt-1 opacity-80'>{t('workspaceCreation.notConfirmedHint')}</p>
      </WorkspaceCreationCallout>
    );
    okText = t('workspaceCreation.checkAgain');
    canSubmit = true;
    secondaryAction = (
      <Button variant='ghost' disabled={flow.submitting} onClick={() => discard(false)}>
        {t('workspaceCreation.discard')}
      </Button>
    );
  }

  return (
    <EditWorkspace
      key={creation.scopeKey}
      open={open}
      openOnChange={onOpenChange}
      onOk={flow.submit}
      okText={okText}
      canSubmit={canSubmit}
      nameReadOnly={Boolean(draft)}
      defaultName={draft?.name ?? defaultName}
      secondaryAction={secondaryAction}
    >
      {notice}
    </EditWorkspace>
  );
}

export default CreateWorkspaceDialog;
