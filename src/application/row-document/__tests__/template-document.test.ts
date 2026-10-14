import { assertAtomicCreationAvailable, captureAtomicCreationOwner } from '@/application/atomic-creation';

import { hasPendingAtomicRowFirstBody, prepareAtomicRowFirstBody } from '../atomic-first-body';
import { ensureAtomicTemplateDocument } from '../template-document';

jest.mock('@/application/atomic-creation', () => ({
  captureAtomicCreationOwner: jest.fn(), assertAtomicCreationAvailable: jest.fn(),
}));
jest.mock('../atomic-first-body', () => ({ prepareAtomicRowFirstBody: jest.fn(), hasPendingAtomicRowFirstBody: jest.fn() }));

beforeEach(() => jest.resetAllMocks());

it.each([false, true])('uses the atomic blank schema only for a missing template body (exists=%s)', async (exists) => {
  const owner = { assertCurrent: jest.fn() };
  const session = { createEmpty: jest.fn(), dispose: jest.fn() };

  jest.mocked(captureAtomicCreationOwner).mockReturnValue(owner as never);
  jest.mocked(prepareAtomicRowFirstBody).mockResolvedValue(session as never);
  await ensureAtomicTemplateDocument({
    workspaceId: 'workspace', documentId: '11111111-1111-4111-8111-111111111111', assertWritable: jest.fn(),
    exists: jest.fn(async () => exists),
  } as never);
  if (exists) {
    expect(prepareAtomicRowFirstBody).not.toHaveBeenCalled();
    expect(assertAtomicCreationAvailable).not.toHaveBeenCalled();
  } else {
    expect(session.createEmpty).toHaveBeenCalledTimes(1);
    expect(session.dispose).toHaveBeenCalledTimes(1);
  }
});

it('recovers an exact pending template request instead of replacing it with a blank recipe', async () => {
  const session = { createEmpty: jest.fn(), publish: jest.fn(), dispose: jest.fn() };

  jest.mocked(captureAtomicCreationOwner).mockReturnValue({ assertCurrent: jest.fn() } as never);
  jest.mocked(hasPendingAtomicRowFirstBody).mockResolvedValue(true);
  jest.mocked(prepareAtomicRowFirstBody).mockResolvedValue(session as never);
  const exists = jest.fn(async () => true);

  await ensureAtomicTemplateDocument({ workspaceId: 'workspace', exists } as never);
  expect(exists).not.toHaveBeenCalled();
  expect(assertAtomicCreationAvailable).not.toHaveBeenCalled();
  expect(session.createEmpty).toHaveBeenCalledTimes(1);
  expect(session.publish).not.toHaveBeenCalled();
  expect(session.dispose).toHaveBeenCalledTimes(1);
});

it('disposes the template owner if blank initialization fails without creating a local body', async () => {
  const session = { createEmpty: jest.fn().mockRejectedValue(new Error('offline')), dispose: jest.fn() };

  jest.mocked(captureAtomicCreationOwner).mockReturnValue({ assertCurrent: jest.fn() } as never);
  jest.mocked(prepareAtomicRowFirstBody).mockResolvedValue(session as never);
  await expect(ensureAtomicTemplateDocument({
    workspaceId: 'workspace', exists: jest.fn(async () => false),
  } as never)).rejects.toThrow('offline');
  expect(session.dispose).toHaveBeenCalledTimes(1);
});
