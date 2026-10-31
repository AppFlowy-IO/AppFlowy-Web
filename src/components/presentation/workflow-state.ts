import { PresentationAPIError } from './server-client';

import type { VersionedId } from './server-contract';
import type { PageSnapshot, SavedDeck } from './types';

/** A workspace catalog does not establish that a deck belongs to the currently selected page. */
export function regenerationReference(deck: SavedDeck, source: PageSnapshot): VersionedId {
  if (
    !deck.version ||
    !source.serverSource ||
    source.serverSource.revision !== source.revision ||
    deck.sourceRevision !== source.revision
  )
    throw new PresentationAPIError(
      'Select the original, unchanged source before regenerating this saved presentation.',
      'SOURCE_REVISION_CONFLICT',
      409
    );
  return { id: deck.id, version: deck.version };
}
