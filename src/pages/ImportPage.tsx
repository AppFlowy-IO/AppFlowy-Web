import { useCallback, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useNavigate, useSearchParams } from 'react-router-dom';

import { ReactComponent as AppflowyLogo } from '@/assets/icons/appflowy.svg';
import Import from '@/components/_shared/more-actions/importer/Import';
import { Button } from '@/components/ui/button';

/**
 * Direct link to the new-workspace importer. The importer can always be closed, so an account that
 * cannot import, or decides not to, still reaches its existing workspaces.
 */
function ImportPage() {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const [search, setSearch] = useSearchParams();
  const redirectTo = search.get('redirectToImport');
  const initialSource = useRef(search.get('source'));
  const onSuccess = useCallback(() => {
    if (redirectTo) {
      window.location.href = redirectTo;
    }
  }, [redirectTo]);
  const openImporter = () =>
    setSearch((previous) => {
      previous.set('action', 'import');
      if (initialSource.current) previous.set('source', initialSource.current);
      return previous;
    });
  const openApp = () => navigate('/app');

  return (
    <div className='flex h-screen w-screen flex-col bg-background-primary'>
      <header className='flex h-[60px] shrink-0 items-center p-4'>
        <button
          type='button'
          aria-label={t('invitation.openWorkspace')}
          className='h-full w-[141px] cursor-pointer'
          onClick={openApp}
        >
          <AppflowyLogo className='h-full w-full' />
        </button>
      </header>
      <main className='flex flex-1 items-center justify-center px-6'>
        <div className='flex w-full max-w-[400px] flex-col gap-4 text-center'>
          <h1 className='text-xl font-semibold text-text-primary'>{t('workspaceCreation.importWorkspace')}</h1>
          <p className='text-sm text-text-secondary'>{t('workspaceCreation.importPageHint')}</p>
          <div className='flex flex-col gap-2'>
            <Button size='lg' onClick={openImporter}>
              {t('workspaceCreation.importWorkspace')}
            </Button>
            <Button size='lg' variant='outline' onClick={openApp}>
              {t('invitation.openWorkspace')}
            </Button>
          </div>
        </div>
      </main>
      <Import onSuccessfulImport={onSuccess} />
    </div>
  );
}

export default ImportPage;
