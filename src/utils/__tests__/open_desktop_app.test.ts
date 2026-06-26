/// <reference types="jest" />
import {
  attemptOpenDesktopApp,
  isDesktopAppLikelyMissing,
  openInDesktopApp,
} from '../open_desktop_app';

const warning = jest.fn();

jest.mock('sonner', () => ({
  toast: {
    warning: (...args: unknown[]) => warning(...args),
  },
}));

jest.mock('@/i18n/config', () => ({
  i18nInstance: { t: (key: string) => key },
}));

const MISSING_FLAG_KEY = 'appflowy:desktop-app-missing-at';

function setHidden(hidden: boolean) {
  Object.defineProperty(document, 'hidden', { configurable: true, get: () => hidden });
}

describe('open_desktop_app — not installed handling', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    window.localStorage.clear();
    warning.mockClear();
    setHidden(false);
  });

  afterEach(() => {
    jest.runOnlyPendingTimers();
    jest.useRealTimers();
  });

  describe('isDesktopAppLikelyMissing', () => {
    it('is false with no flag', () => {
      expect(isDesktopAppLikelyMissing()).toBe(false);
    });

    it('is true for a fresh flag and false (and cleared) once expired', () => {
      window.localStorage.setItem(MISSING_FLAG_KEY, String(Date.now()));
      expect(isDesktopAppLikelyMissing()).toBe(true);

      const eightDaysAgo = Date.now() - 8 * 24 * 60 * 60 * 1000;

      window.localStorage.setItem(MISSING_FLAG_KEY, String(eightDaysAgo));
      expect(isDesktopAppLikelyMissing()).toBe(false);
      expect(window.localStorage.getItem(MISSING_FLAG_KEY)).toBeNull();
    });
  });

  describe('attemptOpenDesktopApp', () => {
    it('reports opened and clears the missing flag when the page loses visibility', () => {
      window.localStorage.setItem(MISSING_FLAG_KEY, String(Date.now()));
      const onOpened = jest.fn();
      const onNotInstalled = jest.fn();

      attemptOpenDesktopApp('appflowy-flutter://open-page', { onOpened, onNotInstalled });

      setHidden(true);
      document.dispatchEvent(new Event('visibilitychange'));

      expect(onOpened).toHaveBeenCalledTimes(1);
      expect(onNotInstalled).not.toHaveBeenCalled();
      expect(window.localStorage.getItem(MISSING_FLAG_KEY)).toBeNull();
    });

    it('reports not-installed and remembers it when the timeout elapses', () => {
      const onOpened = jest.fn();
      const onNotInstalled = jest.fn();

      attemptOpenDesktopApp('appflowy-flutter://open-page', {
        timeout: 2500,
        onOpened,
        onNotInstalled,
      });

      jest.advanceTimersByTime(2500);

      expect(onNotInstalled).toHaveBeenCalledTimes(1);
      expect(onOpened).not.toHaveBeenCalled();
      expect(isDesktopAppLikelyMissing()).toBe(true);
    });

    it('only settles once (timeout after a success is ignored)', () => {
      const onOpened = jest.fn();
      const onNotInstalled = jest.fn();

      attemptOpenDesktopApp('appflowy-flutter://open-page', { onOpened, onNotInstalled });

      window.dispatchEvent(new Event('blur'));
      jest.advanceTimersByTime(5000);

      expect(onOpened).toHaveBeenCalledTimes(1);
      expect(onNotInstalled).not.toHaveBeenCalled();
    });
  });

  describe('openInDesktopApp', () => {
    it('skips the attempt and stays on web (no prompt) when the app is known missing', () => {
      window.localStorage.setItem(MISSING_FLAG_KEY, String(Date.now()));
      const onContinueInBrowser = jest.fn();

      openInDesktopApp('appflowy-flutter://open-page', { onContinueInBrowser });

      expect(onContinueInBrowser).toHaveBeenCalledTimes(1);
      expect(warning).not.toHaveBeenCalled();
    });

    it('attempts even when known missing if forced', () => {
      window.localStorage.setItem(MISSING_FLAG_KEY, String(Date.now()));
      const onContinueInBrowser = jest.fn();

      openInDesktopApp('appflowy-flutter://open-page', { force: true, onContinueInBrowser });

      // forced attempt is in-flight, not the immediate skip path
      expect(onContinueInBrowser).not.toHaveBeenCalled();

      jest.advanceTimersByTime(2500);

      // timeout → not installed → prompt + proceed to web
      expect(warning).toHaveBeenCalledTimes(1);
      expect(onContinueInBrowser).toHaveBeenCalledTimes(1);
    });

    it('shows the prompt and proceeds to web when an attempt times out', () => {
      const onContinueInBrowser = jest.fn();

      openInDesktopApp('appflowy-flutter://open-page', { onContinueInBrowser });

      jest.advanceTimersByTime(2500);

      expect(warning).toHaveBeenCalledTimes(1);
      expect(onContinueInBrowser).toHaveBeenCalledTimes(1);
    });
  });
});
