import { toast } from 'sonner';

import { i18nInstance } from '@/i18n/config';
import { desktopDownloadLink, openAppFlowySchema } from '@/utils/url';

/**
 * Notion-style "open in desktop app" handling, focused on the "app not installed" case.
 *
 * Browsers cannot reliably tell whether a desktop app is installed, so we use the standard
 * attempt-and-observe heuristic: fire the `appflowy-flutter://` scheme, then watch for the page
 * losing focus/visibility within a timeout. If focus leaves, the OS launched the app; if the
 * timeout elapses with the page still focused, we treat the app as not installed.
 *
 * To avoid stalling on every link for a user who turned the "open in desktop app" preference on but
 * never installed the app, a "not detected" result is remembered per-device (localStorage) and the
 * attempt is skipped next time — the user simply stays on the web page. The flag expires so the app
 * is re-probed if the user installs it later, and it is cleared immediately whenever an attempt
 * succeeds.
 */

/**
 * Whether a path points at a specific page (`/app/{workspace}/{view}`) — i.e. a shareable page
 * link. Used to fire the preference-driven desktop handoff only when the app was opened directly
 * from such a link, not on internal client-side navigation.
 */
export function isSpecificPagePath(pathname: string): boolean {
  return /^\/app\/[^/]+\/[^/]+/.test(pathname);
}

/** Build the `open-page` deep link that opens a specific page/view in the desktop app. */
export function buildOpenPageLink(opts: {
  workspaceId: string;
  viewId: string;
  email?: string | null;
  rowId?: string | null;
}): string {
  const { workspaceId, viewId, email, rowId } = opts;

  return `appflowy-flutter://open-page?workspace_id=${workspaceId}&view_id=${viewId}&email=${encodeURIComponent(
    email ?? ''
  )}${rowId ? `&row_id=${rowId}` : ''}`;
}

/** Build the `invitation-callback` deep link that opens an invited workspace in the desktop app. */
export function buildInvitationCallbackLink(opts: { workspaceId: string; email?: string | null }): string {
  const { workspaceId, email } = opts;

  return `appflowy-flutter://invitation-callback?workspace_id=${workspaceId}&email=${encodeURIComponent(email ?? '')}`;
}

const MISSING_FLAG_KEY = 'appflowy:desktop-app-missing-at';
/** Re-probe roughly weekly in case the user installs the desktop app later. */
const MISSING_TTL_MS = 7 * 24 * 60 * 60 * 1000;
/** How long to wait for the page to lose focus before concluding the app did not open. */
const DEFAULT_DETECT_TIMEOUT = 2500;

/**
 * Whether we have recently detected, on this device, that the desktop app did not open. When true,
 * callers should avoid the (slow, prompt-triggering) launch attempt and stay on the web instead.
 */
export function isDesktopAppLikelyMissing(): boolean {
  try {
    const raw = window.localStorage.getItem(MISSING_FLAG_KEY);

    if (!raw) return false;

    const at = Number(raw);

    if (!Number.isFinite(at) || Date.now() - at > MISSING_TTL_MS) {
      window.localStorage.removeItem(MISSING_FLAG_KEY);
      return false;
    }

    return true;
  } catch {
    // localStorage may be unavailable (private mode, blocked cookies) — assume not-missing.
    return false;
  }
}

function rememberDesktopAppMissing(): void {
  try {
    window.localStorage.setItem(MISSING_FLAG_KEY, String(Date.now()));
  } catch {
    // ignore storage failures
  }
}

function rememberDesktopAppPresent(): void {
  try {
    window.localStorage.removeItem(MISSING_FLAG_KEY);
  } catch {
    // ignore storage failures
  }
}

interface AttemptOptions {
  /** Detection window in ms; the app is considered missing if focus does not leave within it. */
  timeout?: number;
  /** Called when the desktop app appears to have opened (page lost focus/visibility). */
  onOpened?: () => void;
  /** Called when the timeout elapsed without the app taking focus. */
  onNotInstalled?: () => void;
}

/**
 * Fire the deep link and infer, via focus/visibility, whether the desktop app opened. Always makes
 * an attempt; updates the per-device "missing" memory based on the result. Most callers should use
 * {@link openInDesktopApp}, which layers the not-installed prompt and skip-when-known-missing logic
 * on top of this.
 */
export function attemptOpenDesktopApp(scheme: string, options: AttemptOptions = {}): void {
  const { timeout = DEFAULT_DETECT_TIMEOUT, onOpened, onNotInstalled } = options;

  let settled = false;
  let timer = 0;
  const iframe = document.createElement('iframe');

  const cleanup = () => {
    window.clearTimeout(timer);
    document.removeEventListener('visibilitychange', onVisibilityChange);
    window.removeEventListener('blur', onWindowBlur);

    if (iframe.parentNode) {
      iframe.parentNode.removeChild(iframe);
    }
  };

  const succeed = () => {
    if (settled) return;
    settled = true;
    cleanup();
    rememberDesktopAppPresent();
    onOpened?.();
  };

  const fail = () => {
    if (settled) return;
    settled = true;
    cleanup();
    rememberDesktopAppMissing();
    onNotInstalled?.();
  };

  const onVisibilityChange = () => {
    if (document.hidden) succeed();
  };

  const onWindowBlur = () => succeed();

  document.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('blur', onWindowBlur);
  timer = window.setTimeout(fail, timeout);

  // Fire the scheme via a hidden iframe so that a missing protocol handler does not navigate the
  // current page away (unlike assigning to window.location).
  try {
    iframe.style.display = 'none';
    iframe.src = scheme;
    document.body.appendChild(iframe);
  } catch {
    fail();
  }
}

/**
 * Notion-style fallback shown when the desktop app could not be opened. Non-blocking: the user stays
 * on (or is taken to) the web experience and may download the app or dismiss.
 */
export function notifyDesktopAppNotInstalled(): void {
  const t = i18nInstance.t.bind(i18nInstance);

  toast.warning(t('openInDesktopApp.notInstalled.title'), {
    description: t('openInDesktopApp.notInstalled.description'),
    duration: 10000,
    action: {
      label: t('openInDesktopApp.notInstalled.download'),
      onClick: () => window.open(desktopDownloadLink, '_blank'),
    },
    // sonner's cancel button simply dismisses the toast (the user is already on the web).
    cancel: {
      label: t('openInDesktopApp.notInstalled.continueInBrowser'),
      onClick: () => undefined,
    },
  });
}

interface OpenInDesktopOptions {
  /** Attempt even if the app was previously detected missing on this device (e.g. a button press). */
  force?: boolean;
  /** Called when the app appears to have opened. */
  onOpened?: () => void;
  /** Called when we stay on the web (app missing, skipped, or the user chose the browser). */
  onContinueInBrowser?: () => void;
}

/**
 * Open a target in the AppFlowy desktop app, handling "app not installed" gracefully like Notion:
 *
 * - If the app was already detected missing on this device, skip the attempt and stay on the web
 *   (no repeated stall/prompt) — unless `force` is set.
 * - Otherwise attempt to launch; on success the caller's `onOpened` runs, on failure we surface a
 *   non-blocking download/continue prompt and remember the result for next time.
 */
export function openInDesktopApp(
  scheme: string = openAppFlowySchema,
  options: OpenInDesktopOptions = {},
): void {
  const { force = false, onOpened, onContinueInBrowser } = options;

  if (!force && isDesktopAppLikelyMissing()) {
    // Already learned the app isn't here on this device — proceed to web without nagging again.
    onContinueInBrowser?.();
    return;
  }

  attemptOpenDesktopApp(scheme, {
    onOpened,
    onNotInstalled: () => {
      notifyDesktopAppNotInstalled();
      onContinueInBrowser?.();
    },
  });
}
