import { act, renderHook } from '@testing-library/react';

import { useAppLanguage } from '../useAppLanguage';

const mockI18n = { language: 'en', changeLanguage: jest.fn() };

jest.mock('react-i18next', () => ({ useTranslation: () => ({ i18n: mockI18n }) }));

describe('useAppLanguage', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockI18n.language = 'en';
    mockI18n.changeLanguage.mockImplementation((language: string) => {
      mockI18n.language = language;
      return Promise.resolve();
    });
    jest.spyOn(window.navigator, 'language', 'get').mockReturnValue('en-US');
  });

  afterEach(() => jest.restoreAllMocks());

  it('uses the profile preference on startup and ignores browser changes', () => {
    renderHook(() => useAppLanguage('fr-FR'));

    expect(mockI18n.language).toBe('fr-FR');
    void act(() => window.dispatchEvent(new Event('languagechange')));
    expect(mockI18n.changeLanguage).toHaveBeenCalledTimes(1);
    expect(mockI18n.changeLanguage).not.toHaveBeenCalledWith('en-US');
  });

  it('applies a preference when the profile arrives and follows later account changes', () => {
    const { rerender } = renderHook(({ language }: { language?: string }) => useAppLanguage(language), {
      initialProps: { language: undefined as string | undefined },
    });

    expect(mockI18n.language).toBe('en-US');
    rerender({ language: 'ja-JP' });
    expect(mockI18n.language).toBe('ja-JP');
    rerender({ language: 'de-DE' });
    expect(mockI18n.language).toBe('de-DE');
    rerender({ language: undefined });
    expect(mockI18n.language).toBe('en-US');
  });

  it('follows browser language changes only while mounted without a preference', () => {
    const { unmount } = renderHook(() => useAppLanguage());

    jest.spyOn(window.navigator, 'language', 'get').mockReturnValue('es-ES');
    void act(() => window.dispatchEvent(new Event('languagechange')));
    expect(mockI18n.language).toBe('es-ES');
    unmount();
    mockI18n.changeLanguage.mockClear();
    void act(() => window.dispatchEvent(new Event('languagechange')));
    expect(mockI18n.changeLanguage).not.toHaveBeenCalled();
  });
});
