import { Types, ViewLayout } from '@/application/types';

import { getCollabTypeFromViewLayout } from './DuplicateModal';

describe('getCollabTypeFromViewLayout', () => {
  it.each([ViewLayout.Grid, ViewLayout.Board, ViewLayout.Calendar, ViewLayout.Chart])(
    'maps database layout %s to the database collab type',
    (layout) => {
      expect(getCollabTypeFromViewLayout(layout)).toBe(Types.Database);
    }
  );

  it('maps document layouts to the document collab type', () => {
    expect(getCollabTypeFromViewLayout(ViewLayout.Document)).toBe(Types.Document);
  });

  it('rejects unsupported layouts', () => {
    expect(getCollabTypeFromViewLayout(ViewLayout.AIChat)).toBeNull();
  });
});
