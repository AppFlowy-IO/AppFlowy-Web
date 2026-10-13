import { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as InfoIcon } from '@/assets/icons/info.svg';
import { ReactComponent as WarningIcon } from '@/assets/icons/warning.svg';
import { WorkspaceCreationCapabilityState } from '@/components/app/hooks/useWorkspaceCreationCapability';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';

/** A short explanation beside the controls it affects, with optional actions. */
export function WorkspaceCreationCallout({
  tone = 'info',
  role = 'status',
  children,
  actions,
}: {
  tone?: 'info' | 'warning';
  role?: 'status' | 'alert';
  children: ReactNode;
  actions?: ReactNode;
}) {
  const Icon = tone === 'warning' ? WarningIcon : InfoIcon;

  return (
    <div
      role={role}
      className={cn(
        'flex flex-col gap-2 rounded-300 px-3 py-2 text-sm',
        tone === 'warning' ? 'bg-fill-warning-light text-text-warning-on-fill' : 'bg-fill-content-hover text-text-primary'
      )}
    >
      <div className='flex items-start gap-2'>
        <Icon
          aria-hidden='true'
          className={cn('mt-0.5 h-4 w-4 shrink-0', tone === 'warning' ? 'text-icon-warning-thick' : 'text-icon-secondary')}
        />
        <div className='min-w-0 flex-1 whitespace-pre-wrap break-words'>{children}</div>
      </div>
      {actions && <div className='flex flex-wrap items-center justify-end gap-2'>{actions}</div>}
    </div>
  );
}

/**
 * Why new-workspace actions are unavailable. Check again is offered only when the answer could not
 * be read; a denial is a decision, and the answer refreshes on its own when permissions change.
 */
export function WorkspaceCreationNotice({
  capability,
  showOwnership = false,
  showCheckAgain = true,
}: {
  capability: WorkspaceCreationCapabilityState;
  showOwnership?: boolean;
  /** Hide when the surrounding page already offers its own Check again. */
  showCheckAgain?: boolean;
}) {
  const { t } = useTranslation();

  if (capability.status === 'ready' && capability.canCreate) {
    return showOwnership ? <p className='text-sm text-text-secondary'>{t('workspaceCreation.ownership')}</p> : null;
  }

  if (capability.status === 'loading') {
    return (
      <div role='status' className='flex items-center gap-2 text-sm text-text-secondary'>
        <Progress variant='primary' />
        <span>{t('workspaceCreation.loading')}</span>
      </div>
    );
  }

  if (capability.status === 'error') {
    return (
      <WorkspaceCreationCallout
        tone='warning'
        role='alert'
        actions={
          showCheckAgain && (
            <Button size='sm' variant='outline' loading={capability.checking} onClick={() => void capability.refresh()}>
              {t('workspaceCreation.checkAgain')}
            </Button>
          )
        }
      >
        {t('workspaceCreation.unavailable')}
      </WorkspaceCreationCallout>
    );
  }

  return <WorkspaceCreationCallout>{t('workspaceCreation.denied')}</WorkspaceCreationCallout>;
}

/** The translation key explaining why new-workspace actions are unavailable, if they are. */
export function workspaceCreationBlockedReason(capability: WorkspaceCreationCapabilityState) {
  if (capability.canCreate) return;
  if (capability.status === 'ready') return 'workspaceCreation.denied' as const;
  return capability.status === 'error' ? ('workspaceCreation.unavailable' as const) : ('workspaceCreation.loading' as const);
}
