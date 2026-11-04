import { lazy, Suspense, useRef, useState } from 'react';

import { ReactComponent as AIIcon } from '@/assets/icons/ai.svg';
import { useAIEnabled, useAppView, useUserWorkspaceInfoOptional } from '@/components/app/app.hooks';
import { useViewActionPermissions } from '@/components/app/view-actions/useViewActionPermissions';
import { Button } from '@/components/ui/button';

import { presentationAIAccessReason } from './presentation-policy';
import { loadPresentationDialog, preloadPresentation } from './presentation-preload';
import PresentationMenu from './PresentationMenu';
import { Mode } from './types';

import type { PresentationSourceProps } from './PresentationDialog';

const PresentationDialog = lazy(loadPresentationDialog);

export default function PresentEntry({
  slidesOnly = false,
  ...source
}: PresentationSourceProps & { slidesOnly?: boolean }) {
  const [mode, setMode] = useState<Mode>();
  const [menuOpen, setMenuOpen] = useState(false);
  const aiEnabled = useAIEnabled();
  const deck = source.deck;
  const trigger = useRef<HTMLButtonElement>(null);
  const permissionViewId = source.permissionViewId ?? source.viewId;
  const permissionView = useAppView(permissionViewId);
  const role = useUserWorkspaceInfoOptional()?.selectedWorkspace.role;
  // Read only while the menu is open; the current page's permission is usually already cached.
  const { canWrite, hasLoadedViewActionPermissions } = useViewActionPermissions(
    permissionView,
    menuOpen,
    permissionViewId
  );
  const aiUnavailableReason = slidesOnly
    ? undefined
    : presentationAIAccessReason({ role, canWrite, permissionsLoaded: menuOpen && hasLoadedViewActionPermissions });
  const open = (next: Mode) => {
    if (next !== 'document' && !aiEnabled) return;
    // Fetch the dialog and the chosen mode's chunk together instead of one after the other.
    preloadPresentation(next);
    setMode(next);
  };

  if (slidesOnly && !aiEnabled) return null;

  return (
    <>
      {slidesOnly ? (
        <Button ref={trigger} size='sm' variant={deck ? 'outline' : 'default'} onClick={() => open('slides')}>
          <AIIcon className='h-4 w-4' aria-hidden='true' />
          {deck ? 'Open preview' : 'Generate AI ppt'}
        </Button>
      ) : (
        <PresentationMenu
          ref={trigger}
          onSelect={open}
          aiEnabled={aiEnabled}
          aiUnavailableReason={aiUnavailableReason}
          onOpenChange={setMenuOpen}
        />
      )}
      {mode && (
        <Suspense fallback={null}>
          <PresentationDialog {...source} anchorEl={trigger.current} mode={mode} onClose={() => setMode(undefined)} />
        </Suspense>
      )}
    </>
  );
}
