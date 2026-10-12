import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';

import { useCurrentWorkspaceId, useEnsureViewVisibleInOutline, useOpenPageModal } from '@/components/app/app.hooks';
import { useSpaceCreationIntent } from '@/components/app/hooks/useSpaceCreationIntent';
import { Button } from '@/components/ui/button';

const CreateSpaceModal = lazy(() => import('@/components/app/view-actions/CreateSpaceModal'));

/** Recovery remains reachable when B is denied, even with no visible spaces. */
export function PendingSpaceCreation() {
  const workspaceId = useCurrentWorkspaceId();
  const { intent, error, store } = useSpaceCreationIntent(workspaceId);
  const { t } = useTranslation();
  const [openScope, setOpenScope] = useState<string>();
  const ensureVisible = useEnsureViewVisibleInOutline();
  const openPage = useOpenPageModal();

  if (error) return <p role='alert' className='px-3 text-sm'>{error}</p>;
  if (!intent) return null;
  return (
    <div className='px-2' data-testid='pending-space-creation'>
      <Button variant='ghost' onClick={() => setOpenScope(store.scopeKey)} data-testid='resume-space-creation'>
        {t('spaceCreation.resume')}
      </Button>
      {openScope === store.scopeKey && (
        <Suspense fallback={<p role='status'>{t('loading')}</p>}>
          <CreateSpaceModal open onClose={() => setOpenScope(undefined)} onCreated={async (spaceId, pageId) => {
            await ensureVisible?.(pageId ?? spaceId);
            store.assertCurrent();
            if (pageId) openPage?.(pageId);
          }} />
        </Suspense>
      )}
    </div>
  );
}
