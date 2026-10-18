import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';

import translations from '@/@types/translations/en.json';

import { AIMeetingLanguageBanner } from '../AIMeetingLanguageBanner';

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key.split('.').reduce<unknown>((current, part) => (current as Record<string, unknown>)?.[part], translations) }),
}));

const message = translations.document.aiMeeting.import.languageSupportMessage;

beforeEach(() => { localStorage.clear(); });
afterEach(() => { cleanup(); jest.restoreAllMocks(); });

it('reads dismissal for the current workspace when the same banner instance changes workspace', () => {
  const { rerender } = render(<AIMeetingLanguageBanner workspaceId='first' />);

  fireEvent.click(screen.getByRole('button', { name: 'Dismiss language support message' }));
  expect(screen.queryByText(message)).toBeNull();
  rerender(<AIMeetingLanguageBanner workspaceId='second' />);
  expect(screen.getByText(message)).toBeTruthy();
  rerender(<AIMeetingLanguageBanner workspaceId='first' />);
  expect(screen.queryByText(message)).toBeNull();
});

it('uses one storage listener for multiple banners and removes it after the last subscriber leaves', () => {
  const add = jest.spyOn(window, 'addEventListener');
  const remove = jest.spyOn(window, 'removeEventListener');
  const first = render(<AIMeetingLanguageBanner workspaceId='first' />);
  const second = render(<AIMeetingLanguageBanner workspaceId='second' />);

  expect(add.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(1);
  first.unmount();
  expect(remove.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(0);
  second.unmount();
  expect(remove.mock.calls.filter(([type]) => type === 'storage')).toHaveLength(1);
});

it('updates only the affected workspace for cross-tab storage changes and restores banners when storage is cleared', () => {
  render(<><AIMeetingLanguageBanner workspaceId='first' /><AIMeetingLanguageBanner workspaceId='second' /></>);
  localStorage.setItem('hasClickedAIMeetingBanner_first', 'true');
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key: 'hasClickedAIMeetingBanner_first' })); });
  expect(screen.getAllByText(message)).toHaveLength(1);
  localStorage.clear();
  act(() => { window.dispatchEvent(new StorageEvent('storage', { key: null })); });
  expect(screen.getAllByText(message)).toHaveLength(2);
});

it('shares dismissal across open blocks when browser storage is blocked', () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Storage unavailable'); });
  render(<><AIMeetingLanguageBanner workspaceId='blocked' /><AIMeetingLanguageBanner workspaceId='blocked' /></>);
  fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss language support message' })[0]);
  expect(screen.queryByText(message)).toBeNull();
});
