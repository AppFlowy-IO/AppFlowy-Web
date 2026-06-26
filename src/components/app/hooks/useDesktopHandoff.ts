import { useCallback } from 'react';

import { useOpenInDesktopApp } from '@/components/app/hooks/useOpenInDesktopApp';
import { openInDesktopApp } from '@/utils/open_desktop_app';

interface HandoffOptions {
  /**
   * Called once the handoff resolves to "stay on the web": either the preference is off, or the
   * desktop app could not be opened. NOT called when the desktop app opened. Use it to navigate to
   * the web target (e.g. the workspace) for flows that aren't already on the destination page.
   */
  onStayInBrowser?: () => void;
}

/**
 * Preference-gated handoff to the desktop app. When the user's "open links in desktop app"
 * preference is enabled, attempts to open `scheme` in the desktop app (with the not-installed
 * handling in `openInDesktopApp`); otherwise stays on the web.
 */
export function useDesktopHandoff() {
  const { enabled } = useOpenInDesktopApp();

  const handoff = useCallback(
    (scheme: string, options: HandoffOptions = {}): boolean => {
      if (!enabled) {
        options.onStayInBrowser?.();
        return false;
      }

      openInDesktopApp(scheme, {
        // App opened — nothing to do on the web side.
        onContinueInBrowser: options.onStayInBrowser,
      });
      return true;
    },
    [enabled]
  );

  return { enabled, handoff };
}
