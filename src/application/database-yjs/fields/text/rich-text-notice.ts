import { t } from 'i18next';

import { notify } from '@/components/_shared/notify';

// One user action (a multi-row drag, a clear field, a burst of keystrokes)
// can be refused for several cells; the user hears about it once.
const NOTICE_INTERVAL_MS = 1500;
let lastNoticeAt = -Infinity;

/** Tells the user that a cell can only be edited by a newer version of AppFlowy (R51, R54). */
export function notifyRichTextNewer() {
  const now = Date.now();

  if (now - lastNoticeAt < NOTICE_INTERVAL_MS) return;
  lastNoticeAt = now;
  notify.error(
    t('grid.row.richTextRequiresNewerVersion', {
      defaultValue:
        'This text was formatted in a newer version of AppFlowy. Update AppFlowy (refresh this page) to edit it.',
    })
  );
}

/** Test hook: lets the next refusal show its notice again. */
export function resetRichTextNewerNotice() {
  lastNoticeAt = -Infinity;
}
