import { View, ViewLayout } from '../types';
import { canBeMoved, isLinkedDatabaseViewUnderDocument } from '../view-utils';

function view(overrides: Partial<View>): View {
  return {
    view_id: 'view',
    name: 'View',
    icon: null,
    layout: ViewLayout.Document,
    extra: null,
    children: [],
    is_private: false,
    ...overrides,
  };
}

describe('database pages directly under spaces', () => {
  it.each([
    { is_space: true },
    { extra: { is_space: true } },
  ])('allows moving a database under a space described by %j', (space) => {
    const parent = view({ view_id: 'space', ...space });
    const database = view({ view_id: 'database', layout: ViewLayout.Board });

    expect(isLinkedDatabaseViewUnderDocument(database, parent)).toBe(false);
    expect(canBeMoved(database, parent)).toBe(true);
  });

  it('keeps a database embedded in a regular document protected from moving', () => {
    const database = view({ layout: ViewLayout.Grid });
    const document = view({ view_id: 'document' });

    expect(isLinkedDatabaseViewUnderDocument(database, document)).toBe(true);
    expect(canBeMoved(database, document)).toBe(false);
  });
});
