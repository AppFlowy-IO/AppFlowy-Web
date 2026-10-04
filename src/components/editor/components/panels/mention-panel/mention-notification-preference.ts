import { useSyncExternalStore } from 'react';

const key = 'atMenuSendNotification';
const changed = 'appflowy:mention-notification-preference';

// The choice of this page while browser storage cannot be written (private
// mode, blocked site data), so that flipping the switch still takes effect.
let unsaved: boolean | undefined;

export function getSendMentionNotification(): boolean {
  if (unsaved !== undefined) return unsaved;

  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

export function setSendMentionNotification(value: boolean) {
  try {
    localStorage.setItem(key, String(value));
    unsaved = undefined;
  } catch {
    unsaved = value;
  }

  window.dispatchEvent(new Event(changed));
}

function subscribe(onChange: () => void) {
  // `storage` reports flips made in other tabs, `changed` those of this one.
  window.addEventListener('storage', onChange);
  window.addEventListener(changed, onChange);
  return () => {
    window.removeEventListener('storage', onChange);
    window.removeEventListener(changed, onChange);
  };
}

function getServerSnapshot() {
  return false;
}

/**
 * Documents and cells share the same browser preference, off by default. It
 * lives in the browser, not in React: every open menu reads it from there, so
 * a flip in one menu or tab shows in all of them.
 */
export function useSendMentionNotification(): [boolean, (value: boolean) => void] {
  return [useSyncExternalStore(subscribe, getSendMentionNotification, getServerSnapshot), setSendMentionNotification];
}
