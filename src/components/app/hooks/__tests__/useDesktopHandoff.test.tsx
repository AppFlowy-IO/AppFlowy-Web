/// <reference types="jest" />
import { renderHook } from '@testing-library/react';

import { useDesktopHandoff } from '../useDesktopHandoff';

const mockOpenInDesktopApp = jest.fn();
let mockEnabled = false;

jest.mock('@/utils/open_desktop_app', () => ({
  openInDesktopApp: (...args: unknown[]) => mockOpenInDesktopApp(...args),
}));

jest.mock('@/components/app/hooks/useOpenInDesktopApp', () => ({
  useOpenInDesktopApp: () => ({ enabled: mockEnabled, isSet: true, setEnabled: jest.fn() }),
}));

describe('useDesktopHandoff', () => {
  beforeEach(() => {
    mockOpenInDesktopApp.mockClear();
    mockEnabled = false;
  });

  it('stays in the browser when the preference is off', () => {
    mockEnabled = false;
    const onStayInBrowser = jest.fn();
    const { result } = renderHook(() => useDesktopHandoff());

    const attempted = result.current.handoff('appflowy-flutter://open-page?workspace_id=ws1', {
      onStayInBrowser,
    });

    expect(attempted).toBe(false);
    expect(onStayInBrowser).toHaveBeenCalledTimes(1);
    expect(mockOpenInDesktopApp).not.toHaveBeenCalled();
  });

  it('attempts the desktop app when the preference is on', () => {
    mockEnabled = true;
    const onStayInBrowser = jest.fn();
    const { result } = renderHook(() => useDesktopHandoff());

    const attempted = result.current.handoff('appflowy-flutter://open-page?workspace_id=ws1', {
      onStayInBrowser,
    });

    expect(attempted).toBe(true);
    expect(mockOpenInDesktopApp).toHaveBeenCalledWith('appflowy-flutter://open-page?workspace_id=ws1', {
      onContinueInBrowser: onStayInBrowser,
    });
    // The web fallback only runs if the app can't be opened (handled inside openInDesktopApp),
    // not synchronously here.
    expect(onStayInBrowser).not.toHaveBeenCalled();
  });
});
