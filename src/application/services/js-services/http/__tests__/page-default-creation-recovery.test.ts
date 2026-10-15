import {
  assertAtomicCreationAvailable, atomicRead, AtomicCreationOwner, AtomicCreationPendingError,
  AtomicCreationRecord, captureAtomicCreationOwner, findPendingAtomicCreation, recoverAtomicCreation,
  releaseRefusedAtomicCreation, runAtomicCreation,
} from '@/application/atomic-creation';
import { ViewLayout } from '@/application/types';

import { verifyCreatedPage } from '../created-page-hydration';
import { createDefaultPage, recoverDefaultPage } from '../page-default-creation';

jest.mock('@/application/atomic-creation', () => ({
  assertAtomicCreationAvailable: jest.fn(), atomicRead: jest.fn(), captureAtomicCreationOwner: jest.fn(),
  findPendingAtomicCreation: jest.fn(), recoverAtomicCreation: jest.fn(), runAtomicCreation: jest.fn(),
  releaseRefusedAtomicCreation: jest.fn(),
  parseAtomicCreationRequest: (record: { requestJson: string }) => JSON.parse(record.requestJson),
  AtomicCreationPendingError: class extends Error {
    constructor(readonly record: { id: string }, readonly cause: unknown) {
      super('pending');
    }

    get recordId() {
      return this.record.id;
    }
  },
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

describe('a page the server refuses', () => {
  const denial = { code: 1012, httpStatus: 403, sourceDomain: 'appflowy.server', message: 'not allowed' };

  beforeEach(() => {
    jest.mocked(findPendingAtomicCreation).mockResolvedValue(undefined);
    jest.mocked(atomicRead).mockResolvedValue({ view_id: 'stable-space', children: [] } as never);
  });

  it('releases the never-committed command and answers with the refusal itself', async () => {
    jest.mocked(runAtomicCreation).mockRejectedValue(new AtomicCreationPendingError(record, denial));
    jest.mocked(releaseRefusedAtomicCreation).mockResolvedValue(true);

    await expect(createDefaultPage('workspace', 'stable-space', { layout: ViewLayout.Document })).rejects.toBe(denial);
    expect(releaseRefusedAtomicCreation).toHaveBeenCalledWith(owner, 'journal');
  });

  it('keeps a committed command pending for an explicit retry', async () => {
    const pending = new AtomicCreationPendingError(record, denial);

    jest.mocked(runAtomicCreation).mockRejectedValue(pending);
    jest.mocked(releaseRefusedAtomicCreation).mockResolvedValue(false);
    await expect(createDefaultPage('workspace', 'stable-space', { layout: ViewLayout.Document })).rejects.toBe(pending);
  });

  it('keeps an ambiguous outcome pending without releasing anything', async () => {
    const pending = new AtomicCreationPendingError(record, new Error('response lost'));

    jest.mocked(runAtomicCreation).mockRejectedValue(pending);
    await expect(createDefaultPage('workspace', 'stable-space', { layout: ViewLayout.Document })).rejects.toBe(pending);
    expect(releaseRefusedAtomicCreation).not.toHaveBeenCalled();
  });

  it('releases a refused retry of a saved page too', async () => {
    jest.mocked(recoverAtomicCreation).mockRejectedValue(new AtomicCreationPendingError(record, denial));
    jest.mocked(releaseRefusedAtomicCreation).mockResolvedValue(true);

    await expect(recoverDefaultPage(owner, record)).rejects.toBe(denial);
  });
});
