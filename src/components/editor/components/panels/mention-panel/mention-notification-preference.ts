import { useCallback, useEffect, useState } from 'react';

const key = 'atMenuSendNotification';
const changed = 'appflowy:mention-notification-preference';

export function getSendMentionNotification(): boolean {
  try {
    return localStorage.getItem(key) === 'true';
  } catch {
    return false;
  }
}

export function setSendMentionNotification(value: boolean) {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    /* Storage may be unavailable. */
  }

  window.dispatchEvent(new Event(changed));
}

/** Documents and cells share the same browser preference, off by default. */
export function useSendMentionNotification(open: boolean): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(getSendMentionNotification);

  useEffect(() => {
    const refresh = () => setValue(getSendMentionNotification());

    refresh();
    window.addEventListener('storage', refresh);
    window.addEventListener(changed, refresh);
    return () => {
      window.removeEventListener('storage', refresh);
      window.removeEventListener(changed, refresh);
    };
  }, [open]);
  const update = useCallback((next: boolean) => {
    setSendMentionNotification(next);
    setValue(next);
  }, []);

  return [value, update];
}
