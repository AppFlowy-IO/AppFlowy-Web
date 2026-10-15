import { useCallback, useSyncExternalStore } from 'react';
import { useTranslation } from 'react-i18next';

import { ReactComponent as CloseIcon } from '@/assets/icons/close.svg';
import { Button } from '@/components/ui/button';

const storageKey = (workspaceId: string) => `hasClickedAIMeetingBanner_${workspaceId}`;
const subscriptions = new Map<string, { dismissed: boolean; listeners: Set<() => void> }>();

function wasDismissed(workspaceId: string) {
  try {
    return typeof window !== 'undefined' && window.localStorage.getItem(storageKey(workspaceId)) === 'true';
  } catch {
    return false;
  }
}

function handleStorage(event: StorageEvent) {
  subscriptions.forEach((entry, workspaceId) => {
    if (event.key !== null && event.key !== storageKey(workspaceId)) return;
    entry.dismissed = wasDismissed(workspaceId);
    entry.listeners.forEach((listener) => listener());
  });
}

function subscribe(workspaceId: string, listener: () => void) {
  if (subscriptions.size === 0) window.addEventListener('storage', handleStorage);
  let entry = subscriptions.get(workspaceId);

  if (!entry) {
    entry = { dismissed: wasDismissed(workspaceId), listeners: new Set() };
    subscriptions.set(workspaceId, entry);
  }

  const current = entry;

  current.listeners.add(listener);
  return () => {
    current.listeners.delete(listener);
    if (current.listeners.size === 0) subscriptions.delete(workspaceId);
    if (subscriptions.size === 0) window.removeEventListener('storage', handleStorage);
  };
}

const getServerSnapshot = () => false;

export function AIMeetingLanguageBanner({ workspaceId }: { workspaceId: string }) {
  const { t } = useTranslation();
  const subscribeToWorkspace = useCallback((listener: () => void) => subscribe(workspaceId, listener), [workspaceId]);
  const getSnapshot = useCallback(() => subscriptions.get(workspaceId)?.dismissed ?? wasDismissed(workspaceId), [workspaceId]);
  const dismissed = useSyncExternalStore(subscribeToWorkspace, getSnapshot, getServerSnapshot);

  if (dismissed) return null;

  return (
    <div contentEditable={false} className='mx-4 mb-4 mt-0.5 flex items-center gap-2 rounded-lg bg-[var(--block-bg-color-20)] px-4 py-2 text-sm leading-5 text-text-primary'>
      <span className='flex-1'>{t('document.aiMeeting.import.languageSupportMessage')}</span>
      <Button
        type='button'
        variant='ghost'
        size='icon-sm'
        aria-label={t('document.aiMeeting.import.dismissLanguageBanner')}
        onClick={() => {
          try {
            window.localStorage.setItem(storageKey(workspaceId), 'true');
          } catch {
            // Open blocks still share dismissal when storage is unavailable.
          }

          const entry = subscriptions.get(workspaceId);

          if (entry) {
            entry.dismissed = true;
            entry.listeners.forEach((listener) => listener());
          }
        }}
      >
        <CloseIcon aria-hidden className='h-5 w-5 text-icon-secondary' />
      </Button>
    </div>
  );
}
