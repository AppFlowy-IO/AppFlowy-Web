import { useTranslation } from 'react-i18next';

import { useSpaceCreationCapability } from '@/components/app/hooks/useSpaceCreationCapability';
import { Button } from '@/components/ui/button';

/** Keep a draft usable while permission is unavailable or has been revoked. */
export function SpaceCreationNotice({ permission }: { permission: ReturnType<typeof useSpaceCreationCapability> }) {
  const { t } = useTranslation();

  if (permission.canCreateSpace) return null;
  const key =
    permission.status === 'ready'
      ? 'denied'
      : permission.status === 'unsupported'
      ? 'unsupported'
      : permission.status === 'error'
      ? 'loadError'
      : 'loading';

  return (
    <div role='status' className='mb-3 rounded border border-border-primary p-3 text-sm text-text-secondary'>
      {t(`workspacePermissions.${key}`)}
      {permission.status !== 'loading' && (
        <Button
          variant='ghost'
          onClick={() => {
            void permission.refresh();
          }}
        >
          {t('button.retry')}
        </Button>
      )}
    </div>
  );
}
