import { useCallback } from 'react';

import { useOpenInDesktopApp } from '@/components/app/hooks/useOpenInDesktopApp';
import { openInDesktopApp, promptOpenInDesktopApp } from '@/utils/open_desktop_app';

interface HandoffOptions {
  /**
   * Called once the handoff resolves to "stay on the web": either the preference is off, or the
   * desktop app could not be opened. NOT called when the desktop app opened. Use it to navigate to
   * the web target (e.g. the workspace) for flows that aren't already on the destination page.
   */
  onStayInBrowser?: () => void;
}

/**
 * Preference-gated handoff to the desktop app:
 * - preference ON  → attempt to open `scheme` in the desktop app (with not-installed handling);
 * - preference UNSET (never chosen) → show a one-time prompt; the choice is remembered;
 * - preference OFF → stay on the web.
 */
export function useDesktopHandoff() {
  const { enabled, isSet, setEnabled } = useOpenInDesktopApp();

  const handoff = useCallback(
    (scheme: string, options: HandoffOptions = {}): boolean => {
      if (enabled) {
        openInDesktopApp(scheme, {
          // App opened — nothing to do on the web side.
          onContinueInBrowser: options.onStayInBrowser,
        });
        return true;
      }

      // Never asked: prompt once, and remember the choice so we don't ask again.
      if (!isSet) {
        promptOpenInDesktopApp({
          onOpen: () => {
            void setEnabled(true);
            openInDesktopApp(scheme, { onContinueInBrowser: options.onStayInBrowser });
          },
          onStayInBrowser: () => {
            void setEnabled(false);
            options.onStayInBrowser?.();
          },
        });
        return false;
      }

      // Explicitly disabled — stay on the web.
      options.onStayInBrowser?.();
      return false;
    },
    [enabled, isSet, setEnabled]
  );

  return { enabled, isSet, handoff };
}
