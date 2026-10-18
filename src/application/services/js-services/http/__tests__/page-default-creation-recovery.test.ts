import {
  assertAtomicCreationAvailable, atomicRead, AtomicCreationOwner, AtomicCreationPendingError,
  AtomicCreationRecord, captureAtomicCreationOwner, findPendingAtomicCreation, recoverAtomicCreation,
  runAtomicCreation,
} from '@/application/atomic-creation';
import { ViewLayout } from '@/application/types';

import { verifyCreatedPage } from '../created-page-hydration';
import { createDefaultPage } from '../page-default-creation';

jest.mock('@/application/atomic-creation', () => ({
  assertAtomicCreationAvailable: jest.fn(), atomicRead: jest.fn(), captureAtomicCreationOwner: jest.fn(),
  findPendingAtomicCreation: jest.fn(), recoverAtomicCreation: jest.fn(), runAtomicCreation: jest.fn(),
  parseAtomicCreationRequest: (record: { requestJson: string }) => JSON.parse(record.requestJson),
  AtomicCreationPendingError: class extends Error {},
}));
jest.mock('../created-page-hydration', () => ({ verifyCreatedPage: jest.fn() }));

const owner: AtomicCreationOwner = { workspaceId: 'workspace', userId: 'user', serverUrl: 'server', assertCurrent: jest.fn() };
const request = { schema_version: 'v1', request_id: 'original-request', view_id: 'stable-page',
  parent_view_id: 'stable-space', name: 'Original name', position: { kind: 'end' } };
const record: AtomicCreationRecord<'document'> = { id: 'journal', serverUrl: 'server', userId: 'user', workspaceId: 'workspace',
  kind: 'document', logicalTarget: 'stable-page', requestId: 'original-request', requestJson: JSON.stringify(request),
  state: 'pending', createdAt: 1 };

beforeEach(() => {
  jest.resetAllMocks();
  jest.mocked(captureAtomicCreationOwner).mockReturnValue(owner);
  jest.mocked(verifyCreatedPage).mockResolvedValue({ view_id: 'stable-page' });
  jest.mocked(recoverAtomicCreation).mockImplementation(async (options) => options.hydrate({} as never, owner));
});

it.each(['pending', 'committed'] as const)('resumes a stable initial Document at the saved %s stage without changing its recipe', async (state) => {
  const pending = { ...record, state };
  const activate = jest.fn(async () => {});

  jest.mocked(findPendingAtomicCreation).mockResolvedValue(pending);
  jest.mocked(assertAtomicCreationAvailable).mockImplementation(() => { throw new Error('new creation unavailable'); });
  await expect(createDefaultPage('workspace', 'stable-space', {
    layout: ViewLayout.Document, view_id: 'stable-page', name: 'Changed UI draft',
  }, { activate })).resolves.toEqual({ view_id: 'stable-page' });
  expect(findPendingAtomicCreation).toHaveBeenCalledWith(owner, 'document', 'stable-page');
  expect(jest.mocked(recoverAtomicCreation).mock.calls[0][0].record).toBe(pending);
  expect(verifyCreatedPage).toHaveBeenCalledWith(owner, { kind: 'document', request,
    selectedViewId: 'stable-page' });
  expect(assertAtomicCreationAvailable).not.toHaveBeenCalled();
  expect(atomicRead).not.toHaveBeenCalled();
  expect(runAtomicCreation).not.toHaveBeenCalled();
  expect(activate).toHaveBeenCalledWith({ view_id: 'stable-page' });
});

it('keeps the command pending when a supplied initial Document ID belongs to another parent', async () => {
  jest.mocked(findPendingAtomicCreation).mockResolvedValue(record);
  await expect(createDefaultPage('workspace', 'different-space', {
    layout: ViewLayout.Document, view_id: 'stable-page',
  })).rejects.toBeInstanceOf(AtomicCreationPendingError);
  expect(recoverAtomicCreation).not.toHaveBeenCalled();
  expect(runAtomicCreation).not.toHaveBeenCalled();
  expect(atomicRead).not.toHaveBeenCalled();
});
