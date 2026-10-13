import { ReactNode, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';

import { AccessService } from '@/application/services/domains';
import { clearRedirectTo } from '@/application/session/sign_in';
import { invalidToken } from '@/application/session/token';
import { Invitation, Workspace } from '@/application/types';
import { ReactComponent as AppFlowyLogo } from '@/assets/icons/appflowy.svg';
import Import from '@/components/_shared/more-actions/importer/Import';
import { useAuthInternal } from '@/components/app/contexts/AuthInternalContext';
import { usePendingWorkspaceInvitations } from '@/components/app/hooks/usePendingWorkspaceInvitations';
import { useWorkspaceCreationFlow } from '@/components/app/hooks/useWorkspaceCreationAttempt';
import { useWorkspaceCreationCapability } from '@/components/app/hooks/useWorkspaceCreationCapability';
import { useCurrentUserOptional } from '@/components/main/app.hooks';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import { Button } from '@/components/ui/button';
import { getErrorMessage } from '@/utils/errors';

import { CreateWorkspaceDialog } from './CreateWorkspaceDialog';
import { WorkspaceCreationCallout, WorkspaceCreationNotice } from './WorkspaceCreationNotice';

function WorkspaceRow({
  name,
  icon,
  detail,
  action,
}: {
  name: string;
  icon?: string;
  detail?: string;
  action: ReactNode;
}) {
  return (
    <li className='flex items-center gap-3 rounded-400 border border-border-primary px-3 py-2'>
      <Avatar shape='square' size='md'>
        <AvatarImage src={icon} alt='' />
        <AvatarFallback name={name}>{icon ? <span className='text-lg'>{icon}</span> : name}</AvatarFallback>
      </Avatar>
      <div className='min-w-0 flex-1'>
        <div className='truncate text-sm font-medium text-text-primary'>{name}</div>
        {detail && <div className='truncate text-xs text-text-secondary'>{detail}</div>}
      </div>
      {action}
    </li>
  );
}

function RowSection({ title, children }: { title: string; children: ReactNode }) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId} className='flex flex-col gap-2'>
      <h2 id={headingId} className='text-xs font-medium text-text-secondary'>
        {title}
      </h2>
      <ul className='flex flex-col gap-2'>{children}</ul>
    </section>
  );
}

/**
 * A signed-in account without a workspace. Signing in and joining never require permission to
 * create workspaces; creation and import follow the server's answer for this account.
 */
export function NoWorkspace() {
  const { t } = useTranslation();
  const auth = useAuthInternal();
  const currentUser = useCurrentUserOptional();
  const creation = useWorkspaceCreationCapability();
  const invitations = usePendingWorkspaceInvitations();
  const flow = useWorkspaceCreationFlow(creation, auth.onChangeWorkspace);
  const navigate = useNavigate();
  const [, setSearch] = useSearchParams();
  const [creating, setCreating] = useState(false);
  const [checking, setChecking] = useState(false);
  const [pendingId, setPendingId] = useState<string>();
  const [importReceived, setImportReceived] = useState(false);
  const workspaces = auth.userWorkspaceInfo?.workspaces ?? [];
  const busy = checking || Boolean(pendingId) || flow.submitting;
  const unconfirmed = Boolean(flow.draft && !flow.draft.workspaceId);
  const denied = creation.status === 'ready' && !creation.canCreate;
  // A saved request is settled from its notice, so new creation waits until it is resolved.
  const showCreationActions = !denied && !flow.draft && !flow.unreadable;
  // The most useful enabled action is the primary one.
  const primary = unconfirmed
    ? 'check'
    : invitations.items.length
    ? 'invitation'
    : workspaces.length
    ? 'workspace'
    : showCreationActions && creation.canCreate
    ? 'create'
    : undefined;

  const refreshWorkspaces = () => {
    void auth.refreshUserWorkspaceInfo?.();
  };

  const checkAgain = async () => {
    setChecking(true);
    try {
      // The notice promises that Check again settles an unconfirmed request; replaying its original
      // request never creates a second workspace.
      if (flow.draft && !flow.draft.workspaceId) {
        try {
          await flow.submit(flow.draft.name);
          return;
        } catch (error) {
          toast.error(getErrorMessage(error));
        }
      }

      const [workspaceInfo, invitationsLoaded] = await Promise.all([
        auth.refreshUserWorkspaceInfo ? auth.refreshUserWorkspaceInfo() : auth.userWorkspaceInfo,
        invitations.refresh(),
        creation.refresh(),
      ]);

      if (!workspaceInfo || !invitationsLoaded) toast.error(t('workspaceCreation.checkFailed'));
    } finally {
      setChecking(false);
    }
  };

  const join = async (invitation: Invitation) => {
    setPendingId(invitation.invite_id);
    try {
      await AccessService.acceptInvitation(invitation.invite_id);
      toast.success(t('invitation.success'));
      await auth.onChangeWorkspace(invitation.workspace_id);
    } catch (error) {
      toast.error(getErrorMessage(error));
      void invitations.refresh();
      refreshWorkspaces();
    } finally {
      setPendingId(undefined);
    }
  };

  const open = async (workspace: Workspace) => {
    setPendingId(workspace.id);
    try {
      await auth.onChangeWorkspace(workspace.id);
    } catch (error) {
      toast.error(getErrorMessage(error));
    } finally {
      setPendingId(undefined);
    }
  };

  const openCreated = async (name: string) => {
    try {
      await flow.submit(name);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const discard = () => {
    flow.discard();
    refreshWorkspaces();
  };

  // The app's standard sign-out: a redirect saved by an earlier session must not follow the next one.
  const signOut = () => {
    clearRedirectTo();
    invalidToken();
    navigate('/login?force=true');
  };

  const openImport = () =>
    setSearch((previous) => {
      previous.set('action', 'import');
      previous.set('source', 'appflowy');
      return previous;
    });

  let creationNotice: ReactNode = <WorkspaceCreationNotice capability={creation} showCheckAgain={false} />;

  if (flow.unreadable) {
    creationNotice = (
      <WorkspaceCreationCallout
        tone='warning'
        role='alert'
        actions={
          <Button size='sm' variant='outline' onClick={discard}>
            {t('workspaceCreation.discard')}
          </Button>
        }
      >
        {t('workspaceCreation.invalidDraft')}
      </WorkspaceCreationCallout>
    );
  } else if (flow.draft?.workspaceId) {
    const { name } = flow.draft;

    creationNotice = (
      <WorkspaceCreationCallout
        actions={
          <>
            <Button size='sm' variant='ghost' disabled={busy} onClick={discard}>
              {t('workspaceCreation.dismiss')}
            </Button>
            <Button size='sm' loading={flow.submitting} disabled={busy} onClick={() => void openCreated(name)}>
              {t('workspaceCreation.openWorkspace')}
            </Button>
          </>
        }
      >
        {t('workspaceCreation.createdNotOpened')}
      </WorkspaceCreationCallout>
    );
  } else if (flow.draft) {
    creationNotice = (
      <WorkspaceCreationCallout
        tone='warning'
        actions={
          <Button size='sm' variant='ghost' disabled={busy} onClick={discard}>
            {t('workspaceCreation.discard')}
          </Button>
        }
      >
        <p>{t('workspaceCreation.notConfirmed')}</p>
        <p className='mt-1 opacity-80'>{t('workspaceCreation.notConfirmedHint')}</p>
      </WorkspaceCreationCallout>
    );
  }

  return (
    <main className='flex min-h-screen flex-col bg-background-primary'>
      <header className='flex h-[60px] shrink-0 items-center p-4'>
        <AppFlowyLogo role='img' aria-label='AppFlowy' className='h-full w-[141px]' />
      </header>
      <div className='flex flex-1 justify-center px-6 pb-10 pt-6 sm:items-center sm:pt-0'>
        <div className='flex w-full max-w-[400px] flex-col gap-6'>
          <div className='flex flex-col gap-2 text-center'>
            <h1 className='text-xl font-semibold text-text-primary'>{t('workspaceCreation.noWorkspaceTitle')}</h1>
            {currentUser?.email && (
              <p className='break-words text-sm text-text-primary'>
                {t('workspaceCreation.signedInAs', { email: currentUser.email })}
              </p>
            )}
            <p className='text-sm text-text-secondary'>{t('workspaceCreation.noWorkspaceDescription')}</p>
          </div>

          {invitations.items.length > 0 && (
            <RowSection title={t('workspaceCreation.invitationsTitle')}>
              {invitations.items.map((invitation, index) => {
                // The server may omit the name; an ID means nothing to the person invited.
                const name = invitation.workspace_name || t('workspaceCreation.unnamedWorkspace');
                const inviter = invitation.inviter_name || invitation.inviter_email;
                const joinLabel =
                  !invitation.workspace_name && inviter
                    ? t('workspaceCreation.joinInvitedBy', { name: inviter })
                    : t('workspaceCreation.joinNamed', { name });

                return (
                  <WorkspaceRow
                    key={invitation.invite_id}
                    name={name}
                    icon={invitation.workspace_icon}
                    detail={inviter ? t('workspaceCreation.invitedBy', { name: inviter }) : undefined}
                    action={
                      <Button
                        size='sm'
                        variant={primary === 'invitation' && index === 0 ? 'default' : 'outline'}
                        aria-label={joinLabel}
                        loading={pendingId === invitation.invite_id}
                        disabled={busy}
                        onClick={() => void join(invitation)}
                      >
                        {t('invitation.join')}
                      </Button>
                    }
                  />
                );
              })}
            </RowSection>
          )}

          {workspaces.length > 0 && (
            <RowSection title={t('workspaceCreation.yourWorkspaces')}>
              {workspaces.map((workspace, index) => (
                <WorkspaceRow
                  key={workspace.id}
                  name={workspace.name}
                  icon={workspace.icon}
                  action={
                    <Button
                      size='sm'
                      variant={primary === 'workspace' && index === 0 ? 'default' : 'outline'}
                      aria-label={t('workspaceCreation.openNamed', { name: workspace.name })}
                      loading={pendingId === workspace.id}
                      disabled={busy}
                      onClick={() => void open(workspace)}
                    >
                      {t('workspaceCreation.open')}
                    </Button>
                  }
                />
              ))}
            </RowSection>
          )}

          {creationNotice}
          {importReceived && <WorkspaceCreationCallout>{t('workspaceCreation.importProcessing')}</WorkspaceCreationCallout>}

          <div className='flex flex-col gap-2'>
            {showCreationActions && (
              <>
                <Button
                  size='lg'
                  variant={primary === 'create' ? 'default' : 'outline'}
                  disabled={!creation.canCreate || busy}
                  onClick={() => setCreating(true)}
                >
                  {t('workspace.create')}
                </Button>
                <Button size='lg' variant='outline' disabled={!creation.canCreate || busy} onClick={openImport}>
                  {t('workspaceCreation.importWorkspace')}
                </Button>
              </>
            )}
            <Button
              size='lg'
              variant={primary === 'check' ? 'default' : 'outline'}
              loading={checking}
              disabled={busy && !checking}
              onClick={() => void checkAgain()}
            >
              {t('workspaceCreation.checkAgain')}
            </Button>
            <Button size='lg' variant='ghost' onClick={signOut}>
              {t('workspaceCreation.signOut')}
            </Button>
          </div>
        </div>
      </div>
      {creating && (
        <CreateWorkspaceDialog
          open={creating}
          onOpenChange={setCreating}
          creation={creation}
          flow={flow}
          onDiscarded={refreshWorkspaces}
        />
      )}
      <Import
        successMessage={t('workspaceCreation.importProcessing')}
        onSuccessfulImport={() => {
          setImportReceived(true);
          refreshWorkspaces();
        }}
      />
    </main>
  );
}
