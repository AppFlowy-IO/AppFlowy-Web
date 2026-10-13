import { act, renderHook } from '@testing-library/react';

import { useWorkspaceCreationAttempt, useWorkspaceCreationFlow } from '../useWorkspaceCreationAttempt';

let mockUser = 'actor-a';
const mockCreate = jest.fn();

jest.mock('i18next', () => ({ t: (key: string) => key }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('@/application/session/token', () => ({ getTokenParsed: () => ({ user: { id: mockUser } }) }));
jest.mock('@/application/services/domains', () => ({ WorkspaceService: { create: (...args: unknown[]) => mockCreate(...args) } }));

const creation = {
  status: 'ready',
  canCreate: true,
  checking: false,
  legacy: false,
  refresh: jest.fn(),
  isCurrent: () => true,
  scopeKey: 'server:actor-a',
  capability: undefined,
} as unknown as Parameters<typeof useWorkspaceCreationFlow>[0];

beforeEach(() => {
  sessionStorage.clear();
  mockUser = 'actor-a';
  mockCreate.mockReset();
});

test('a workspace that opened is not reported as failed when the account changes during bookkeeping', async () => {
  mockCreate.mockImplementation(async (_payload: unknown, options: { reserve?: () => string }) => {
    options.reserve?.();
    return 'created';
  });
  const open = jest.fn(async () => {
    // The open switches the API context before the saved request is marked complete.
    mockUser = 'actor-b';
  });
  const { result } = renderHook(() => useWorkspaceCreationFlow(creation, open));

  await act(async () => {
    await expect(result.current.submit('Name')).resolves.toBeUndefined();
  });
  expect(open).toHaveBeenCalledWith('created');
});

test('Discard after an account change leaves that account its own request', () => {
  const { result } = renderHook(() => useWorkspaceCreationAttempt('server:actor-a'));
  const key = 'workspace-creation:v1:' + JSON.stringify(['https://test.appflowy.cloud', 'actor-a']);

  sessionStorage.setItem(key, JSON.stringify({ requestId: 'r', name: 'Pending' }));
  mockUser = 'actor-b';
  expect(() => act(() => result.current.discard())).not.toThrow();
  expect(sessionStorage.getItem(key)).not.toBeNull();
});
