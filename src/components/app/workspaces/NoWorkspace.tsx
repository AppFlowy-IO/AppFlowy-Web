import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { invalidToken } from '@/application/session/token';
import Import from '@/components/_shared/more-actions/importer/Import';
import { useAuthInternal } from '@/components/app/contexts/AuthInternalContext';
import { useWorkspaceCreationAttempt } from '@/components/app/hooks/useWorkspaceCreationAttempt';
import { useWorkspaceCreationCapability } from '@/components/app/hooks/useWorkspaceCreationCapability';
import { Button } from '@/components/ui/button';

import EditWorkspace from './EditWorkspace';
import { WorkspaceCreationNotice } from './WorkspaceCreationNotice';

/** A successful sign-in does not require permission to create a home workspace. */
export function NoWorkspace() {
  const { t } = useTranslation();
  const auth = useAuthInternal();
  const creation = useWorkspaceCreationCapability();
  const navigate = useNavigate();
  const [, setSearch] = useSearchParams();
  const [editing, setEditing] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const attempt = useWorkspaceCreationAttempt(creation.scopeKey);

  const refresh = async () => {
    setRefreshing(true);
    try { await auth.refreshUserWorkspaceInfo?.(); }
    finally { if (creation.isCurrent()) setRefreshing(false); }
  };

  const create = async (name: string) => {
    if (!creation.isCurrent()) throw new Error(t('workspaceCreation.contextChanged'));
    try {
      if (!creation.canCreate && !attempt.draft) throw new Error(t('workspaceCreation.denied'));
      const id = await attempt.create(name);

      if (!creation.isCurrent()) throw new Error(t('workspaceCreation.contextChanged'));
      await auth.onChangeWorkspace(id);
      if (creation.isCurrent()) attempt.complete(id);
    } catch (error) {
      if (creation.isCurrent()) void creation.refresh();
      throw error;
    }
  };

  return <main className='flex min-h-screen items-center justify-center p-6'>
    <div className='flex w-full max-w-lg flex-col gap-4'>
      <h1 className='text-xl font-semibold'>{t('workspaceCreation.noWorkspaceTitle')}</h1>
      <p>{t('workspaceCreation.noWorkspaceDescription')}</p>
      <WorkspaceCreationNotice capability={creation} />
      {auth.userWorkspaceInfo?.workspaces.map((workspace) => <Button key={workspace.id}
        onClick={() => void auth.onChangeWorkspace(workspace.id)}>{workspace.name}</Button>)}
      <Button disabled={Boolean(attempt.error) || (!creation.canCreate && !attempt.draft)} onClick={() => setEditing(true)}>{t(attempt.draft ? 'workspaceCreation.resume' : 'workspace.create')}</Button>
      <Button disabled={!creation.canCreate} onClick={() => setSearch((previous) => {
        previous.set('action', 'import');
        previous.set('source', 'appflowy');
        return previous;
      })}>{t('web.importWorkspace')}</Button>
      <Button disabled={refreshing} onClick={() => void refresh()}>{t('workspaceCreation.refreshWorkspaces')}</Button>
      <button type='button' className='underline' onClick={() => { invalidToken(); navigate('/login'); }}>
        {t('workspaceCreation.signOut')}
      </button>
      <EditWorkspace okText={t(attempt.draft ? 'workspaceCreation.resume' : 'button.create')} key={creation.scopeKey} open={editing} openOnChange={setEditing} onOk={create}
        defaultName={attempt.draft?.name} nameReadOnly={Boolean(attempt.draft)}
        canSubmit={!attempt.error && (creation.canCreate || Boolean(attempt.draft))}>
        <WorkspaceCreationNotice capability={creation} showOwnership />
        {attempt.draft && <p role='status'>{t('workspaceCreation.retryOriginal')}</p>}
        {attempt.error && <p role='alert'>{attempt.error}</p>}
      </EditWorkspace>
      <Import onSuccessfulImport={() => void refresh()} />
    </div>
  </main>;
}
