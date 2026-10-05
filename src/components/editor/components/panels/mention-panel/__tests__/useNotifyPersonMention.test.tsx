import { act, renderHook } from '@testing-library/react';

import conformance from '@/application/database-yjs/fields/text/__tests__/rich-text-conformance.json';
import { MentionType, ViewLayout } from '@/application/types';

import {
  getSendMentionNotification,
  setSendMentionNotification,
  useSendMentionNotification,
} from '../mention-notification-preference';
import { mentionNotificationTitle, useNotifyPersonMention } from '../useNotifyPersonMention';

const mockSend = jest.fn();
const mockError = jest.fn();
const mockLoadMeta = jest.fn();
let mockUserId: string | undefined = 'current-user';

jest.mock('@/application/services/domains', () => ({
  WorkspaceService: { updatePageMention: (...args: unknown[]) => mockSend(...args) },
}));
jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({ workspaceId: 'ws', viewId: 'view', loadViewMeta: mockLoadMeta }),
}));
jest.mock('@/components/main/app.hooks', () => ({
  useCurrentUserOptional: () => (mockUserId ? { uuid: mockUserId } : undefined),
}));
jest.mock('@/components/_shared/notify', () => ({ notify: { error: (...args: unknown[]) => mockError(...args) } }));
jest.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string, fallback: string) => fallback ?? (key === 'menuAppHeader.defaultNewPageName' ? 'Untitled' : key),
  }),
}));

const ada = { type: MentionType.Person, person_id: 'ada' };

beforeEach(() => {
  jest.clearAllMocks();
  localStorage.clear();
  mockUserId = 'current-user';
  mockSend.mockResolvedValue(undefined);
  mockLoadMeta.mockResolvedValue({ name: 'Database name', layout: ViewLayout.Grid });
});

for (const testCase of conformance.sections.notificationTitle.cases) {
  it(testCase.id, () => {
    expect(mentionNotificationTitle(testCase.title, 'Untitled')).toEqual(testCase.expected ?? 'Untitled');
  });
}

it('sends a cell target with the saved row title and no document block', async () => {
  const { result } = renderHook(useNotifyPersonMention);

  expect(
    await result.current({ ...ada, block_id: 'stale-block', page_id: 'stale-view' }, true, {
      viewId: 'database-view',
      rowId: 'row',
      rowTitle: '  Saved\r\nrow  ',
    })
  ).toBe(true);
  expect(mockSend).toHaveBeenCalledWith('ws', 'database-view', {
    person_id: 'ada',
    block_id: null,
    row_id: 'row',
    require_notification: true,
    view_name: 'Saved row',
    view_layout: ViewLayout.Grid,
    is_row_document: false,
  });
});

it.each([undefined, ' ADA '])('skips sends for an unknown or matching current user: %s', async (userId) => {
  mockUserId = userId;
  const { result } = renderHook(useNotifyPersonMention);

  expect(await result.current(ada)).toBe(false);
  expect(mockSend).not.toHaveBeenCalled();
});

it('records document mentions with notifications off by default, using the shared preference', async () => {
  const { result } = renderHook(useNotifyPersonMention);

  await result.current(ada);
  expect(mockSend.mock.calls[0][2].require_notification).toBe(false);
  setSendMentionNotification(true);
  await result.current(ada);
  expect(mockSend.mock.calls[1][2].require_notification).toBe(true);
});

it.each([false, true])('reports a failed send only when notifications were enabled: %s', async (required) => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockSend.mockRejectedValueOnce(new Error('offline'));
  const { result } = renderHook(useNotifyPersonMention);

  expect(await result.current(ada, required)).toBe(false);
  expect(mockError).toHaveBeenCalledTimes(required ? 1 : 0);
  jest.restoreAllMocks();
});

it('keeps open menus in step with browser preference changes', () => {
  const { result } = renderHook(() => useSendMentionNotification());
  const other = renderHook(() => useSendMentionNotification());

  expect(result.current[0]).toBe(false);
  act(() => result.current[1](true));
  expect(getSendMentionNotification()).toBe(true);
  // Every open menu of this tab follows a flip made in one of them.
  expect(result.current[0]).toBe(true);
  expect(other.result.current[0]).toBe(true);
  act(() => {
    localStorage.setItem('atMenuSendNotification', 'false');
    window.dispatchEvent(new StorageEvent('storage', { key: 'atMenuSendNotification' }));
  });
  expect(result.current[0]).toBe(false);
  expect(other.result.current[0]).toBe(false);
});

it('still applies a flip to this page while browser storage cannot be written', () => {
  const { result } = renderHook(() => useSendMentionNotification());
  const blocked = jest.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new Error('blocked');
  });

  act(() => result.current[1](true));
  expect(result.current[0]).toBe(true);
  expect(getSendMentionNotification()).toBe(true);
  blocked.mockRestore();
  // A later flip that can be saved makes storage the source again.
  act(() => result.current[1](false));
  expect(result.current[0]).toBe(false);
  expect(localStorage.getItem('atMenuSendNotification')).toBe('false');
});

it('defaults to no notification when browser storage is unavailable', () => {
  jest.spyOn(Storage.prototype, 'getItem').mockImplementation(() => {
    throw new Error('blocked');
  });
  expect(getSendMentionNotification()).toBe(false);
  jest.restoreAllMocks();
});
