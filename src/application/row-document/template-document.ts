import { assertAtomicCreationAvailable, captureAtomicCreationOwner } from '@/application/atomic-creation';

import { hasPendingAtomicRowFirstBody, prepareAtomicRowFirstBody } from './atomic-first-body';

/** Explicit template editing owns a server document before exposing block tools. */
export async function ensureAtomicTemplateDocument(
  input: Parameters<typeof prepareAtomicRowFirstBody>[0] & {
    exists: (documentId: string) => Promise<boolean>;
  }
): Promise<void> {
  const owner = captureAtomicCreationOwner(input.workspaceId, input.assertWritable);
  const pending = await hasPendingAtomicRowFirstBody(input.workspaceId, input.documentId);

  owner.assertCurrent();
  if (!pending) {
    const exists = await input.exists(input.documentId);

    owner.assertCurrent();
    if (exists) return;
    assertAtomicCreationAvailable(owner);
  }

  const session = await prepareAtomicRowFirstBody({ ...input, requiresInitialRowSnapshot: true });

  try {
    owner.assertCurrent();
    await session.createEmpty();
    owner.assertCurrent();
  } finally {
    session.dispose();
  }
}
