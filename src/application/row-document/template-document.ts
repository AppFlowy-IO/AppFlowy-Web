import * as Y from 'yjs';

import { assertAtomicCreationAvailable, captureAtomicCreationOwner } from '@/application/atomic-creation';
import { YjsEditorKey } from '@/application/types';

import { hasPendingAtomicRowFirstBody, prepareAtomicRowFirstBody } from './atomic-first-body';
import { createFirstBodyDraft, FirstBodyContribution } from './first-body-actions';

/** The v1 action endpoint requires an action; an empty delta keeps its server schema unchanged. */
export function templateDocumentInitialization(documentId: string): FirstBodyContribution {
  const draft = createFirstBodyDraft(documentId);

  try {
    const texts = draft.getMap(YjsEditorKey.data_section).get('document').get('meta').get('text_map') as Y.Map<Y.Text>;
    const textId = texts.keys().next().value as string;

    return { kind: 'default_actions', schema_version: 'v1', actions: [
      { action: 'ApplyTextDelta', payload: { text_id: textId, delta: '[]', update_type: false } },
    ] };
  } finally {
    draft.destroy();
  }
}

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

  const session = await prepareAtomicRowFirstBody(input);

  try {
    owner.assertCurrent();
    if (session.pending) await session.pending();
    else await session.publish(templateDocumentInitialization(input.documentId));
    owner.assertCurrent();
  } finally {
    session.dispose();
  }
}
