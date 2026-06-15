import * as Y from 'yjs';

import { CollabOrigin } from '@/application/types';

/**
 * Apply doc state from server to client
 * Note: origin is always remote
 * @param doc local Y.Doc
 * @param state state from server
 */
export function applyYDoc(doc: Y.Doc, state: Uint8Array, encoderVersion = 1) {
  Y.transact(
    doc,
    () => {
      try {
        if (encoderVersion === 2) {
          Y.applyUpdateV2(doc, state, CollabOrigin.Remote);
        } else {
          Y.applyUpdate(doc, state, CollabOrigin.Remote);
        }
      } catch(e) {
        console.error('Error applying', doc, e);
        throw e;
      }
    },
    CollabOrigin.Remote,
  );
}
