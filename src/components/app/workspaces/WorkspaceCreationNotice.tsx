import { useTranslation } from 'react-i18next';

import { useWorkspaceCreationCapability } from '@/components/app/hooks/useWorkspaceCreationCapability';

export function WorkspaceCreationNotice({
  capability,
  showOwnership = false,
}: {
  capability: ReturnType<typeof useWorkspaceCreationCapability>;
  showOwnership?: boolean;
}) {
  const { t } = useTranslation();
  const key =
    capability.status === 'ready'
      ? capability.canCreate
        ? 'ownership'
        : 'denied'
      : capability.status === 'error'
      ? 'unavailable'
      : capability.status;

  if (capability.canCreate && !showOwnership) return null;
  return (
    <div role='status' className='p-2 text-sm text-text-secondary'>
      <p>{t(`workspaceCreation.${key}`)}</p>
      {(capability.status === 'error' || capability.status === 'unsupported' || !capability.canCreate) &&
        capability.status !== 'loading' && (
          <button type='button' className='mt-1 underline' onClick={() => void capability.refresh()}>
            {t('button.retry')}
          </button>
        )}
    </div>
  );
}
