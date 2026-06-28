/// <reference types="jest" />
import { renderHook } from '@testing-library/react';

import { useDesktopHandoff } from '../useDesktopHandoff';

const mockOpenInDesktopApp = jest.fn();
const mockPrompt = jest.fn();
const mockSetEnabled = jest.fn();
let mockEnabled = false;
let mockIsSet = true;

jest.mock('@/utils/open_desktop_app', () => ({
  openInDesktopApp: (...args: unknown[]) => mockOpenInDesktopApp(...args),
  promptOpenInDesktopApp: (...args: unknown[]) => mockPrompt(...args),
}));

jest.mock('@/components/app/hooks/useOpenInDesktopApp', () => ({
  useOpenInDesktopApp: () => ({ enabled: mockEnabled, isSet: mockIsSet, setEnabled: mockSetEnabled }),
}));

const SCHEME = 'appflowy-flutter://open-page?workspace_id=ws1';

describe('useDesktopHandoff', () => {
  beforeEach(() => {
    mockOpenInDesktopApp.mockClear();
    mockPrompt.mockClear();
    mockSetEnabled.mockClear();
    mockEnabled = false;
    mockIsSet = true;
  });

  it('stays in the browser when the preference is explicitly off', () => {
    mockEnabled = false;
    mockIsSet = true;
    const onStayInBrowser = jest.fn();
    const { result } = renderHook(() => useDesktopHandoff());

    const attempted = result.current.handoff(SCHEME, { onStayInBrowser });

    expect(attempted).toBe(false);
    expect(onStayInBrowser).toHaveBeenCalledTimes(1);
    expect(mockOpenInDesktopApp).not.toHaveBeenCalled();
    expect(mockPrompt).not.toHaveBeenCalled();
  });

  it('attempts the desktop app when the preference is on', () => {
    mockEnabled = true;
    const onStayInBrowser = jest.fn();
    const { result } = renderHook(() => useDesktopHandoff());

    const attempted = result.current.handoff(SCHEME, { onStayInBrowser });

    expect(attempted).toBe(true);
    expect(mockOpenInDesktopApp).toHaveBeenCalledWith(SCHEME, { onContinueInBrowser: onStayInBrowser });
    expect(mockPrompt).not.toHaveBeenCalled();
    // The web fallback only runs if the app can't be opened (inside openInDesktopApp), not here.
    expect(onStayInBrowser).not.toHaveBeenCalled();
  });

  it('prompts once on first use (unset) and remembers the choice', () => {
    mockEnabled = false;
    mockIsSet = false;
    const onStayInBrowser = jest.fn();
    const { result } = renderHook(() => useDesktopHandoff());

    const attempted = result.current.handoff(SCHEME, { onStayInBrowser });

    expect(attempted).toBe(false);
    expect(mockPrompt).toHaveBeenCalledTimes(1);
    expect(mockOpenInDesktopApp).not.toHaveBeenCalled();
    expect(onStayInBrowser).not.toHaveBeenCalled();

    const promptArgs = mockPrompt.mock.calls[0][0] as {
      onOpen: () => void;
      onStayInBrowser?: () => void;
    };

    // "Open in app" → enable the preference and attempt the handoff.
    promptArgs.onOpen();
    expect(mockSetEnabled).toHaveBeenCalledWith(true);
    expect(mockOpenInDesktopApp).toHaveBeenCalledWith(SCHEME, { onContinueInBrowser: onStayInBrowser });

    // "Stay in browser" → disable the preference and stay on the web.
    promptArgs.onStayInBrowser?.();
    expect(mockSetEnabled).toHaveBeenCalledWith(false);
    expect(onStayInBrowser).toHaveBeenCalledTimes(1);
  });
});
