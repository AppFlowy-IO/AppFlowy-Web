import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import en from '@/@types/translations/en.json';
import { useDatabaseContext } from '@/application/database-yjs';
import { RelationLimit } from '@/application/database-yjs/fields/relation/relation.type';
import { getMultiple as getViews } from '@/application/services/domains/view';
import { View, ViewLayout } from '@/application/types';
import { RelationCreationDialog } from '@/components/database/components/property/relation/RelationCreationDialog';

import type { ReactNode } from 'react';

jest.mock('@/application/database-yjs', () => ({
  useDatabaseContext: jest.fn(),
}));

jest.mock('@/application/services/domains/view', () => ({
  getMultiple: jest.fn(),
}));

// Resolve against the real bundle so the assertions below read as the copy the
// user actually sees, and so a missing key fails the test instead of silently
// falling back to an inline default.
function translate(key: string, options?: Record<string, unknown>) {
  const resolved = key
    .split('.')
    .reduce<unknown>((node, part) => (node && typeof node === 'object' ? (node as never)[part] : undefined), en);

  if (typeof resolved !== 'string') return (options?.defaultValue as string) ?? key;

  return resolved.replace(/{{(\w+)}}/g, (_match, name: string) => String(options?.[name] ?? ''));
}

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: translate }),
}));

jest.mock('@/components/_shared/modal', () => ({
  NormalModal: ({ children, open }: { children: ReactNode; open: boolean }) =>
    open ? <div data-testid='relation-modal'>{children}</div> : null,
}));

jest.mock('@/components/database/components/property/relation/RelationView', () => ({
  RelationView: ({ view }: { view: View }) => <span>{view.name}</span>,
}));

jest.mock('@/components/_shared/view-icon/PageIcon', () => ({
  __esModule: true,
  default: () => <span data-testid='page-icon' />,
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdatePropertyIconDispatch: () => jest.fn(),
}));

jest.mock('@/components/database/components/field/FieldCustomIcon', () => ({
  __esModule: true,
  default: () => <span data-testid='field-custom-icon' />,
}));

jest.mock('src/components/_shared/cutsom-icon/CustomIconPopover', () => ({
  __esModule: true,
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

function makeView({
  viewId,
  name,
  databaseId,
  parentViewId,
  isContainer = false,
}: {
  viewId: string;
  name: string;
  databaseId: string;
  parentViewId?: string;
  isContainer?: boolean;
}): View {
  return {
    view_id: viewId,
    parent_view_id: parentViewId,
    name,
    layout: ViewLayout.Grid,
    children: [],
    icon: null,
    extra: {
      database_id: databaseId,
      is_database_container: isContainer,
    },
    is_published: false,
    is_private: false,
  };
}

const currentGrid = makeView({
  viewId: 'current-grid',
  name: 'Grid',
  databaseId: 'current-database',
  parentViewId: 'current-container',
});
const currentContainer = makeView({
  viewId: 'current-container',
  name: 'To-dos',
  databaseId: 'current-database',
  isContainer: true,
});
const relatedGrid = makeView({
  viewId: 'related-grid',
  name: 'Grid',
  databaseId: 'related-database',
  parentViewId: 'related-container',
});
const relatedContainer = makeView({
  viewId: 'related-container',
  name: 'Product roadmap',
  databaseId: 'related-database',
  isContainer: true,
});

const defaultViewsById: Record<string, View> = {
  [currentGrid.view_id]: currentGrid,
  [currentContainer.view_id]: currentContainer,
  [relatedGrid.view_id]: relatedGrid,
  [relatedContainer.view_id]: relatedContainer,
};

function mockViews(viewsById: Record<string, View>) {
  (getViews as jest.MockedFunction<typeof getViews>).mockImplementation(async (_workspaceId, viewIds) => {
    return viewIds.map((viewId) => viewsById[viewId]).filter((view): view is View => Boolean(view));
  });
}

function mockContext({
  viewsById = defaultViewsById,
  databasePageId = currentGrid.view_id,
  loadViewMeta = jest.fn(async (viewId: string) => viewsById[viewId] ?? null),
}: {
  viewsById?: Record<string, View>;
  databasePageId?: string;
  loadViewMeta?: jest.Mock;
} = {}) {
  (useDatabaseContext as jest.Mock).mockReturnValue({
    workspaceId: 'workspace-1',
    databaseDoc: { guid: 'current-database' },
    databasePageId,
    loadDatabaseRelations: jest.fn().mockResolvedValue({
      'current-database': currentGrid.view_id,
      'related-database': relatedGrid.view_id,
    }),
    loadViewMeta,
  });

  return loadViewMeta;
}

function fieldNameValue() {
  return screen.getByTestId<HTMLInputElement>('relation-field-name-input').value;
}

function reciprocalNameValue() {
  return screen.getByTestId<HTMLInputElement>('relation-reciprocal-name-input').value;
}

function renderDialog(onCreate = jest.fn()) {
  render(
    <RelationCreationDialog
      open
      fieldId='field-1'
      initialFieldName='Relation'
      onOpenChange={jest.fn()}
      onCreate={onCreate}
    />
  );

  return onCreate;
}

/** The candidate list lives in a closed dropdown, exactly as on desktop. */
async function openDatabaseDropdown() {
  fireEvent.click(await screen.findByTestId('relation-database-trigger'));
}

describe('RelationCreationDialog', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('lists every database under its own container name', async () => {
    mockViews(defaultViewsById);
    const loadViewMeta = mockContext();

    renderDialog();
    await openDatabaseDropdown();

    const currentCandidate = await screen.findByTestId('relation-candidate-current-database');
    const relatedCandidate = await screen.findByTestId('relation-candidate-related-database');

    // Desktop's `DatabaseMetaItem` shows the plain database name for every row,
    // including the current one — only the trigger relabels it.
    expect(currentCandidate.textContent).toContain('To-dos');
    expect(relatedCandidate.textContent).toContain('Product roadmap');
    expect(currentCandidate.textContent).not.toContain('Grid');
    expect(relatedCandidate.textContent).not.toContain('Grid');

    expect(getViews).toHaveBeenNthCalledWith(1, 'workspace-1', [currentGrid.view_id, relatedGrid.view_id], 0);
    expect(getViews).toHaveBeenNthCalledWith(
      2,
      'workspace-1',
      [currentContainer.view_id, relatedContainer.view_id],
      0
    );
    expect(loadViewMeta).not.toHaveBeenCalled();
  });

  it('keeps the candidate list closed until the trigger is used', async () => {
    mockViews(defaultViewsById);
    mockContext();

    renderDialog();

    await screen.findByTestId('relation-database-trigger');
    expect(screen.queryByTestId('relation-candidate-related-database')).toBeNull();
    expect(screen.getByTestId('relation-database-trigger').textContent).toContain('Select a database...');

    await openDatabaseDropdown();
    expect(screen.queryByTestId('relation-candidate-related-database')).not.toBeNull();
  });

  it('names the property after the target database when one is picked', async () => {
    mockViews(defaultViewsById);
    mockContext();
    const onCreate = renderDialog();

    await openDatabaseDropdown();
    fireEvent.click(await screen.findByTestId('relation-candidate-related-database'));

    // Selecting closes the dropdown and fills the trigger and the name field.
    await waitFor(() => expect(screen.queryByTestId('relation-candidate-related-database')).toBeNull());
    expect(screen.getByTestId('relation-database-trigger').textContent).toContain('Product roadmap');
    expect(fieldNameValue()).toBe('Product roadmap');

    // Enabling two-way names the reciprocal after the SOURCE database.
    fireEvent.click(screen.getByTestId('relation-two-way-switch'));

    expect(screen.getByText('Property name in related database')).not.toBeNull();
    expect(reciprocalNameValue()).toBe('To-dos');

    expect(onCreate).not.toHaveBeenCalled();
  });

  it('uses the self-relation copy when the current database is picked', async () => {
    mockViews(defaultViewsById);
    mockContext();
    renderDialog();

    await openDatabaseDropdown();
    fireEvent.click(await screen.findByTestId('relation-candidate-current-database'));

    // The trigger — and only the trigger — relabels the current database.
    await waitFor(() => expect(screen.queryByTestId('relation-candidate-current-database')).toBeNull());
    expect(screen.getByTestId('relation-database-trigger').textContent).toContain('This database');
    expect(fieldNameValue()).toBe('Related To-dos');

    fireEvent.click(screen.getByTestId('relation-two-way-switch'));

    expect(screen.getByText('Inverse related property name')).not.toBeNull();
    expect(reciprocalNameValue()).toBe('Related back to To-dos');
  });

  it('resolves the current database when opened from a secondary view', async () => {
    const currentBoard = makeView({
      viewId: 'current-board',
      name: 'Board',
      databaseId: 'current-database',
      parentViewId: 'current-container',
    });
    const viewsById = { ...defaultViewsById, [currentBoard.view_id]: currentBoard };

    mockViews(viewsById);
    mockContext({ viewsById, databasePageId: currentBoard.view_id });

    renderDialog();
    await openDatabaseDropdown();
    fireEvent.click(await screen.findByTestId('relation-candidate-current-database'));

    expect(screen.getByTestId('relation-database-trigger').textContent).toContain('This database');
    expect(fieldNameValue()).toBe('Related To-dos');
  });

  it('offers both limit options and defaults to no limit', async () => {
    mockViews(defaultViewsById);
    mockContext();

    renderDialog();

    const trigger = await screen.findByTestId('relation-limit-trigger');

    expect(trigger.textContent).toContain('No limit');

    fireEvent.click(trigger);
    fireEvent.click(screen.getByTestId(`relation-limit-option-${RelationLimit.OneOnly}`));

    await waitFor(() => expect(screen.queryByTestId(`relation-limit-option-${RelationLimit.OneOnly}`)).toBeNull());
    expect(screen.getByTestId('relation-limit-trigger').textContent).toContain('1 page only');
  });

  it('falls back to individual view metadata when batch loading is unavailable', async () => {
    (getViews as jest.MockedFunction<typeof getViews>).mockRejectedValue(new Error('Batch endpoint unavailable'));
    const loadViewMeta = mockContext();

    renderDialog();
    await openDatabaseDropdown();

    expect((await screen.findByTestId('relation-candidate-current-database')).textContent).toContain('To-dos');
    expect(screen.getByTestId('relation-candidate-related-database').textContent).toContain('Product roadmap');
    expect(loadViewMeta).toHaveBeenCalledTimes(4);
  });
});
