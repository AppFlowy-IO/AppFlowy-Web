import { lazy, Suspense, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { toast } from 'sonner';

import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { ReactComponent as ResumeIcon } from '@/assets/icons/restore.svg';
import { ReactComponent as WarningIcon } from '@/assets/icons/warning.svg';
import { useCurrentWorkspaceId, useEnsureViewVisibleInOutline, useOpenPageModal } from '@/components/app/app.hooks';
import { type SpaceCreationIntentState, useSpaceCreationIntent } from '@/components/app/hooks/useSpaceCreationIntent';
import { DiscardSpaceRequestConfirm } from '@/components/app/view-actions/SpaceCreationNotice';
import { Button } from '@/components/ui/button';
import { dropdownMenuItemVariants } from '@/components/ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { cn } from '@/lib/utils';
import { getErrorMessage } from '@/utils/errors';

const CreateSpaceModal = lazy(() => import('@/components/app/view-actions/CreateSpaceModal'));

/**
 * A saved space request stays reachable when B is denied, even with no visible spaces, and can
 * always be discarded so it never becomes a permanent sidebar entry.
 */
export function PendingSpaceCreation() {
  const workspaceId = useCurrentWorkspaceId();
  const recovery = useSpaceCreationIntent(workspaceId);

  // The dialog and the confirmation belong to one server, account and workspace. A switch resets
  // them, so coming back offers the saved request without reopening anything by itself.
  return <PendingSpaceCreationEntry key={recovery.store.scopeKey} recovery={recovery} />;
}

function PendingSpaceCreationEntry({ recovery: { intent, invalid, store } }: { recovery: SpaceCreationIntentState }) {
  const { t } = useTranslation();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const ensureVisible = useEnsureViewVisibleInOutline();
  const openPage = useOpenPageModal();
  const hasSavedRequest = Boolean(intent) || invalid;

  // An open dialog stays until the user closes it, even if its saved request goes away (for
  // example a released draft), so the fields being edited are never lost.
  if (!hasSavedRequest && !dialogOpen) return null;

  const discard = () => {
    setConfirmOpen(false);
    try {
      store.discard();
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <>
      {hasSavedRequest && (
        <div className='mx-1 flex items-start gap-1' data-testid='pending-space-creation'>
          {invalid ? (
            <div
              role='status'
              className={cn(dropdownMenuItemVariants(), 'min-w-0 flex-1 cursor-default items-start text-text-secondary hover:bg-transparent')}
              data-testid='pending-space-creation-invalid'
            >
              <WarningIcon className='text-icon-warning-thick' />
              <span className='min-w-0 flex-1'>{t('spaceCreation.invalidRecovery')}</span>
            </div>
          ) : (
            <button
              type='button'
              className={cn(dropdownMenuItemVariants(), 'min-w-0 flex-1 text-left')}
              onClick={() => setDialogOpen(true)}
              data-testid='resume-space-creation'
            >
              <ResumeIcon className='text-icon-secondary' />
              <span className='truncate'>{t('spaceCreation.resume')}</span>
            </button>
          )}
          <Tooltip disableHoverableContent delayDuration={500}>
            <TooltipTrigger asChild>
              <Button
                type='button'
                variant='ghost'
                size='icon'
                className='mt-0.5'
                aria-label={t('spaceCreation.discardSaved')}
                // Unreadable data holds nothing to keep, so it is discarded without a confirmation.
                onClick={() => (invalid ? discard() : setConfirmOpen(true))}
                data-testid='discard-space-creation'
              >
                <CloseIcon />
              </Button>
            </TooltipTrigger>
            <TooltipContent>{t('spaceCreation.discardSaved')}</TooltipContent>
          </Tooltip>
          <DiscardSpaceRequestConfirm open={confirmOpen} onCancel={() => setConfirmOpen(false)} onConfirm={discard} />
        </div>
      )}
      {dialogOpen && (
        <Suspense fallback={<p role='status' className='mx-1 text-sm text-text-secondary'>{t('loading')}</p>}>
          <CreateSpaceModal open onClose={() => setDialogOpen(false)} onCreated={async (spaceId, pageId) => {
            await ensureVisible?.(pageId ?? spaceId);
            store.assertCurrent();
            if (pageId) openPage?.(pageId);
          }} />
        </Suspense>
      )}
    </>
  );
}
