import { renderHook } from '@testing-library/react';
import fs from 'fs';
import path from 'path';

import { useAppThemeMode } from '../useAppThemeMode';

/**
 * index.html applies the theme before the first paint with an inline script,
 * so a server-rendered page does not show in the light theme and then flip to
 * dark when the app mounts. That script must decide exactly as
 * useAppThemeMode does; this runs both on the same inputs.
 */

const indexHtml = fs.readFileSync(path.resolve(__dirname, '../../../../index.html'), 'utf8');
const scriptSource = indexHtml.match(/<script id="appflowy-theme-init">([\s\S]*?)<\/script>/)?.[1];

// eslint-disable-next-line @typescript-eslint/no-implied-eval
const runInitScript = () => new Function(scriptSource ?? '')();

const darkMode = () => document.documentElement.getAttribute('data-dark-mode');

type Scenario = {
  search: string;
  stored: string | null;
  systemDark: boolean;
  expected: 'true' | 'false';
};

const setUp = ({ search, stored, systemDark }: Scenario) => {
  window.history.replaceState({}, '', `/docs/page${search}`);
  localStorage.clear();
  if (stored !== null) localStorage.setItem('dark-mode', stored);
  window.matchMedia = jest.fn(
    () =>
      ({
        matches: systemDark,
        addEventListener: jest.fn(),
        removeEventListener: jest.fn(),
      }) as unknown as MediaQueryList
  );
  document.documentElement.removeAttribute('data-dark-mode');
};

describe('theme init script in index.html', () => {
  const originalMatchMedia = window.matchMedia;

  afterEach(() => {
    window.matchMedia = originalMatchMedia;
    localStorage.clear();
    window.history.replaceState({}, '', '/');
    document.documentElement.removeAttribute('data-dark-mode');
  });

  it('is present', () => {
    expect(scriptSource).toContain("setAttribute('data-dark-mode'");
  });

  it.each<Scenario>([
    { search: '', stored: null, systemDark: true, expected: 'true' },
    { search: '', stored: null, systemDark: false, expected: 'false' },
    { search: '', stored: 'true', systemDark: false, expected: 'true' },
    { search: '', stored: 'false', systemDark: true, expected: 'false' },
    { search: '?theme=dark', stored: 'false', systemDark: false, expected: 'true' },
    { search: '?theme=light', stored: 'true', systemDark: true, expected: 'false' },
    // Any other ?theme= value pins the stored choice and ignores the system.
    { search: '?theme=other', stored: null, systemDark: true, expected: 'false' },
    { search: '?theme=other', stored: 'true', systemDark: false, expected: 'true' },
    { search: '?theme=', stored: null, systemDark: true, expected: 'true' },
    { search: '?template=true', stored: null, systemDark: true, expected: 'true' },
  ])('decides like useAppThemeMode: search=$search stored=$stored systemDark=$systemDark', (scenario) => {
    setUp(scenario);
    runInitScript();

    const fromScript = darkMode();

    setUp(scenario);
    renderHook(() => useAppThemeMode());

    expect(fromScript).toBe(scenario.expected);
    expect(darkMode()).toBe(scenario.expected);
  });

  it('leaves the theme to the app when storage is unavailable', () => {
    setUp({ search: '', stored: null, systemDark: true, expected: 'true' });

    const getItem = jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
      throw new Error('SecurityError');
    });

    try {
      expect(runInitScript).not.toThrow();
      expect(darkMode()).toBeNull();
    } finally {
      getItem.mockRestore();
    }
  });
});
