import { useTranslation } from 'react-i18next';

import {
  isSpaceCreationDenial,
  readSpaceCreationAdmission,
  type SpaceCreationAdmission,
} from '@/application/services/js-services/space-creation-recovery';
import { NormalModal } from '@/components/_shared/modal';
import { useSpaceCreationCapability } from '@/components/app/hooks/useSpaceCreationCapability';
import { WorkspaceCreationCallout } from '@/components/app/workspaces/WorkspaceCreationNotice';
import { Button } from '@/components/ui/button';

import type { ReactNode } from 'react';

type SpaceCreationCapabilityState = ReturnType<typeof useSpaceCreationCapability>;
export type SpaceCreationPermission = Pick<SpaceCreationCapabilityState, 'status' | 'canCreateSpace' | 'refresh'> &
  Partial<Pick<SpaceCreationCapabilityState, 'capability' | 'error'>>;
export type SpaceCreationUnavailableReason = 'denied' | 'loadError' | 'loading';

/**
 * Whether an entry point may start space creation: the current decision allows it, or the
 * server predates the capability route and decides by itself (old servers stay usable).
 * While a confirmed answer is rechecked in the background it stays on screen; sending a request
 * always re-reads admission first (see refreshSpaceCreationAdmission).
 */
export function canStartSpaceCreation(
  permission: Pick<SpaceCreationPermission, 'status' | 'canCreateSpace' | 'capability'>
) {
  if (permission.canCreateSpace || permission.status === 'unsupported') return true;
  return permission.status === 'loading' && permission.capability?.can_create_space === true;
}

/**
 * The visible reason creation cannot start, or undefined when it can. The hook keeps a known
 * answer (allowed, denied, an older server, a refusal) on screen while it is rechecked, so a
 * background recheck never flashes "Checking permissions"; only a first check or a retry does.
 */
export function spaceCreationUnavailableReason(
  permission: Pick<SpaceCreationPermission, 'status' | 'canCreateSpace' | 'capability' | 'error'>
): SpaceCreationUnavailableReason | undefined {
  if (canStartSpaceCreation(permission)) return;
  // A refused read is the server's answer, not a check that could not run.
  if (permission.status === 'error' && isSpaceCreationDenial(permission.error)) return 'denied';
  // A confirmed denial stays visible while it is rechecked or the recheck fails.
  const denied = permission.capability
    ? permission.capability.can_create_space === false
    : permission.status === 'ready';

  if (denied) return 'denied';
  return permission.status === 'error' ? 'loadError' : 'loading';
}

export function spaceCreationUnavailableKey(reason: SpaceCreationUnavailableReason) {
  return `workspacePermissions.${reason}` as const;
}

/**
 * Fresh admission before a new request. Uses the live capability read, then one direct read
 * when that read has no answer, so a server without the capability route can still decide.
 */
export async function refreshSpaceCreationAdmission(
  permission: Pick<SpaceCreationPermission, 'refresh'>,
  workspaceId: string
): Promise<SpaceCreationAdmission> {
  const capability = await permission.refresh();

  if (capability) return capability.can_create_space ? 'allowed' : 'denied';
  return readSpaceCreationAdmission(workspaceId);
}

const NOTICE_CLASS =
  'mb-3 flex items-center justify-between gap-3 rounded-400 border border-border-primary px-3 py-2 text-sm';

/** Keep a draft usable while permission is unavailable or has been revoked. */
export function SpaceCreationNotice({ permission }: { permission: SpaceCreationPermission }) {
  const { t } = useTranslation();
  const reason = spaceCreationUnavailableReason(permission);

  if (!reason) return null;

  return (
    <div role='status' data-testid='space-creation-notice' className={`${NOTICE_CLASS} text-text-secondary`}>
      <span className='min-w-0 flex-1'>{t(spaceCreationUnavailableKey(reason))}</span>
      {reason === 'loadError' && (
        <Button
          type='button'
          variant='outline'
          size='sm'
          onClick={() => {
            void permission.refresh();
          }}
        >
          {t('spaceCreation.tryAgain')}
        </Button>
      )}
    </div>
  );
}

/** Saved requests whose notice offers Discard. Only 'unconfirmed' can still be checked again. */
const DISCARD_MESSAGES = {
  unconfirmed: 'spaceCreation.unconfirmed',
  invalid: 'spaceCreation.invalidRecovery',
  // The space exists, but its saved first page can't be matched.
  firstPageElsewhere: 'spaceCreation.firstPageElsewhere',
  firstPageUnconfirmed: 'spaceCreation.firstPageUnconfirmed',
} as const;

type SpaceCreationRecoveryNoticeProps =
  | { kind: keyof typeof DISCARD_MESSAGES; onDiscard: () => void; disabled?: boolean }
  | { kind: 'membersPending'; count: number; onAddLater: () => void; disabled?: boolean };

/** A saved request that needs a decision: check again or discard it, or finish without the rest. */
export function SpaceCreationRecoveryNotice(props: SpaceCreationRecoveryNoticeProps) {
  const { t } = useTranslation();
  const message =
    props.kind === 'membersPending'
      ? t('spaceCreation.membersPending', { count: props.count })
      : t(DISCARD_MESSAGES[props.kind]);

  return (
    <div
      role='status'
      data-testid={`space-creation-recovery-${props.kind}`}
      className={`${NOTICE_CLASS} text-text-primary`}
    >
      <span className='min-w-0 flex-1'>{message}</span>
      {props.kind === 'membersPending' ? (
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={props.disabled}
          onClick={props.onAddLater}
          data-testid='space-creation-add-later'
        >
          {t('spaceCreation.addLater')}
        </Button>
      ) : (
        <Button
          type='button'
          variant='outline'
          size='sm'
          disabled={props.disabled}
          onClick={props.onDiscard}
          data-testid='space-creation-discard'
        >
          {t('spaceCreation.discard')}
        </Button>
      )}
    </div>
  );
}

/**
 * The space creation rule refused the request. Nothing was created and nothing is kept, so the form
 * gives way to a summary of what was asked, the answer, and Close as the only action (like Desktop).
 */
export function SpaceCreationDeniedCard({ summary, onClose }: { summary?: ReactNode; onClose: () => void }) {
  const { t } = useTranslation();

  return (
    <div className='flex flex-col gap-4 py-2' data-testid='create-space-denied'>
      {summary}
      <WorkspaceCreationCallout
        actions={
          <Button type='button' variant='outline' size='sm' onClick={onClose} data-testid='create-space-denied-close'>
            {t('button.close')}
          </Button>
        }
      >
        <p>{t('workspacePermissions.denied')}</p>
        <p className='mt-1 opacity-80'>{t('spaceCreation.deniedHint')}</p>
      </WorkspaceCreationCallout>
    </div>
  );
}

/** Discarding forgets this tab's saved request; a space that was already created remains. */
export function DiscardSpaceRequestConfirm({
  open,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useTranslation();

  return (
    <NormalModal
      open={open}
      danger
      title={t('spaceCreation.discardTitle')}
      okText={t('spaceCreation.discard')}
      onOk={onConfirm}
      onCancel={onCancel}
      onClose={onCancel}
      okButtonProps={{ 'data-testid': 'discard-space-request-confirm' }}
    >
      <p className='text-sm text-text-secondary'>{t('spaceCreation.discardDescription')}</p>
    </NormalModal>
  );
}
