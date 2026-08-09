import EventEmitter from 'events';

import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';

import { APP_EVENTS } from '@/application/constants';
import { useDatabase, useDatabaseContext } from '@/application/database-yjs';
import { DatabaseContextState } from '@/application/database-yjs/context';
import { useUpdateDatabaseView } from '@/application/database-yjs/dispatch';
import { View, ViewLayout } from '@/application/types';
import { DatabaseTabs } from '@/components/database/components/tabs/DatabaseTabs';

jest.mock('@/application/database-yjs', () => ({
  useDatabase: jest.fn(),
  useDatabaseContext: jest.fn(),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateDatabaseView: jest.fn(),
}));

jest.mock('@/components/database/components/conditions', () => ({
  DatabaseActions: () => null,
}));

jest.mock('@/components/database/components/tabs/DatabaseViewTabs', () => ({
  DatabaseViewTabs: () => null,
}));

jest.mock('@/components/app/view-actions/RenameModal', () => ({
  __esModule: true,
  default: () => <div data-testid='rename-modal' />,
}));

jest.mock('@/components/database/components/tabs/DeleteViewConfirm', () => () => null);

const databaseView: View = {
  view_id: 'database-view-id',
  parent_view_id: 'database-container-id',
  name: 'Grid',
  layout: ViewLayout.Grid,
  children: [],
  icon: null,
  extra: {
    database_id: 'database-id',
    embedded: true,
  },
  is_published: false,
  is_private: false,
};

const databaseContainer: View = {
  view_id: 'database-container-id',
  parent_view_id: 'row-document-id',
  name: 'New Database',
  layout: ViewLayout.Grid,
  children: [databaseView],
  icon: null,
  extra: {
    database_id: 'database-id',
    embedded: true,
    is_database_container: true,
  },
  is_published: false,
  is_private: false,
};

function setupContext({
  container = databaseContainer,
  updateContainerPage,
  eventEmitter,
}: {
  container?: View;
  updateContainerPage: jest.Mock;
  eventEmitter: EventEmitter;
}) {
  const loadViewMeta = jest.fn(async (viewId: string) => {
    if (viewId === databaseView.view_id) return databaseView;
    if (viewId === container.view_id) return container;
    return null;
  });

  (useDatabaseContext as jest.Mock).mockReturnValue({
    isDocumentBlock: true,
    loadViewMeta,
    readOnly: false,
    showActions: true,
    updatePage: updateContainerPage,
    eventEmitter,
  } as DatabaseContextState);
}

function renderTabs() {
  return render(
    <DatabaseTabs
      databasePageId={databaseView.view_id}
      selectedViewId={databaseView.view_id}
      viewIds={[databaseView.view_id]}
    />
  );
}

async function startInlineEditing() {
  const title = await screen.findByTestId('embedded-database-title-rename');

  fireEvent.click(title);

  return screen.getByTestId('embedded-database-title-input');
}

describe('DatabaseTabs embedded database title rename', () => {
  const updateDatabaseView = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    (useDatabase as jest.Mock).mockReturnValue(undefined);
    (useUpdateDatabaseView as jest.Mock).mockReturnValue(updateDatabaseView);
  });

  it('renames the database container inline instead of the selected tab', async () => {
    const updateContainerPage = jest.fn().mockResolvedValue(undefined);
    const eventEmitter = new EventEmitter();

    setupContext({ updateContainerPage, eventEmitter });
    renderTabs();

    const input = await startInlineEditing();

    expect(input.value).toBe('New Database');
    expect(screen.queryByTestId('rename-modal')).toBeNull();

    fireEvent.change(input, { target: { value: 'Renamed Database' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(updateContainerPage).toHaveBeenCalledWith(databaseContainer.view_id, {
        name: 'Renamed Database',
      });
      expect(screen.getByTestId('embedded-database-title').textContent).toBe('Renamed Database');
    });

    expect(updateDatabaseView).not.toHaveBeenCalled();

    // The optimistic name survives an outline refresh that has not caught up yet.
    await act(async () => {
      eventEmitter.emit(APP_EVENTS.OUTLINE_LOADED, [databaseContainer]);
    });

    expect(screen.getByTestId('embedded-database-title').textContent).toBe('Renamed Database');

    // The server confirms our write, which retires the optimistic name.
    await act(async () => {
      eventEmitter.emit(APP_EVENTS.VIEW_META_CHANGED, { ...databaseContainer, name: 'Renamed Database' });
    });

    // A later remote rename then wins.
    await act(async () => {
      eventEmitter.emit(APP_EVENTS.VIEW_META_CHANGED, { ...databaseContainer, name: 'Remote Database' });
    });

    expect(screen.getByTestId('embedded-database-title').textContent).toBe('Remote Database');
  });

  // Regression: the old dialog applied its select-all on a 100ms timer that raced
  // the dialog's own autofocus. When the timer lost, the caret sat at the end of
  // the pre-filled name and typing appended to it ("New Database" + "123") instead
  // of replacing it. Inline editing must select the whole name up front.
  it('focuses and fully selects the current name so typing replaces it', async () => {
    const updateContainerPage = jest.fn().mockResolvedValue(undefined);
    const eventEmitter = new EventEmitter();

    setupContext({ updateContainerPage, eventEmitter });
    renderTabs();

    const input = await startInlineEditing();

    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe('New Database'.length);
  });

  it('commits the rename on blur', async () => {
    const updateContainerPage = jest.fn().mockResolvedValue(undefined);
    const eventEmitter = new EventEmitter();

    setupContext({ updateContainerPage, eventEmitter });
    renderTabs();

    const input = await startInlineEditing();

    fireEvent.change(input, { target: { value: 'Blurred Name' } });
    fireEvent.blur(input);

    await waitFor(() => {
      expect(updateContainerPage).toHaveBeenCalledWith(databaseContainer.view_id, { name: 'Blurred Name' });
    });
  });

  it('discards the draft on Escape', async () => {
    const updateContainerPage = jest.fn().mockResolvedValue(undefined);
    const eventEmitter = new EventEmitter();

    setupContext({ updateContainerPage, eventEmitter });
    renderTabs();

    const input = await startInlineEditing();

    fireEvent.change(input, { target: { value: 'Discarded' } });
    fireEvent.keyDown(input, { key: 'Escape' });

    await waitFor(() => {
      expect(screen.queryByTestId('embedded-database-title-input')).toBeNull();
    });

    expect(updateContainerPage).not.toHaveBeenCalled();
    expect(screen.getByTestId('embedded-database-title').textContent).toBe('New Database');
  });

  it('does not send a rename when the name is unchanged or blank', async () => {
    const updateContainerPage = jest.fn().mockResolvedValue(undefined);
    const eventEmitter = new EventEmitter();

    setupContext({ updateContainerPage, eventEmitter });
    renderTabs();

    const unchanged = await startInlineEditing();

    fireEvent.keyDown(unchanged, { key: 'Enter' });

    const blank = await startInlineEditing();

    fireEvent.change(blank, { target: { value: '   ' } });
    fireEvent.keyDown(blank, { key: 'Enter' });

    await waitFor(() => {
      expect(screen.queryByTestId('embedded-database-title-input')).toBeNull();
    });

    expect(updateContainerPage).not.toHaveBeenCalled();
    expect(screen.getByTestId('embedded-database-title').textContent).toBe('New Database');
  });

  it('keeps an untitled database renameable', async () => {
    const untitledContainer = { ...databaseContainer, name: '   ' };
    const updateContainerPage = jest.fn().mockResolvedValue(undefined);
    const eventEmitter = new EventEmitter();

    setupContext({ container: untitledContainer, updateContainerPage, eventEmitter });
    renderTabs();

    const title = await screen.findByTestId('embedded-database-title-rename');

    expect(title.textContent).toBe('untitled');

    fireEvent.click(title);

    const input = screen.getByTestId('embedded-database-title-input');

    expect(input.value).toBe('   ');

    fireEvent.change(input, { target: { value: 'Named At Last' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    await waitFor(() => {
      expect(updateContainerPage).toHaveBeenCalledWith(untitledContainer.view_id, { name: 'Named At Last' });
    });
  });
});
