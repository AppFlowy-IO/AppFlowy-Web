import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState } from '@/application/database-yjs/context';
import { FieldType } from '@/application/database-yjs/database.type';
import {
  DatabaseViewLayout,
  YDatabase,
  YDatabaseField,
  YDatabaseView,
  YDoc,
  YjsDatabaseKey,
  YjsEditorKey,
} from '@/application/types';
import { AFConfigContext } from '@/components/main/app.hooks';

import { DatabaseTemplateButton } from '../DatabaseTemplateButton';

import type { ReactNode } from 'react';

jest.unmock('lodash-es/isEqual');

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (_key: string, fallback: string) => fallback,
}));

jest.mock('sonner', () => ({
  toast: {
    error: jest.fn(),
  },
}));

jest.mock('@/application/db', () => ({
  deleteCollabDB: jest.fn(),
  getCachedProviderDoc: jest.fn(),
  openCollabDB: jest.fn(async () => new Y.Doc()),
}));

jest.mock('@/components/database/components/header/DatabaseRowHeader', () => ({
  __esModule: true,
  default: ({ rowId, templateStyle }: { rowId: string; templateStyle?: boolean }) => (
    <div data-testid='mock-template-header' data-template-style={String(Boolean(templateStyle))}>
      {rowId}
    </div>
  ),
}));

let mockPendingDocumentMetaFlush: (() => void) | undefined;

jest.mock('@/components/database/components/database-row', () => {
  const React = jest.requireActual<typeof import('react')>('react');

  return {
    DatabaseRowProperties: ({ rowId, templateStyle }: { rowId: string; templateStyle?: boolean }) => (
      <div data-testid='mock-template-properties' data-template-style={String(Boolean(templateStyle))}>
        {rowId}
      </div>
    ),
    RowSubDocument: ({
      rowId,
      contentPadding,
      onRegisterPendingMetaFlush,
    }: {
      rowId: string;
      contentPadding?: string;
      onRegisterPendingMetaFlush?: (flush: (() => void) | null) => void;
    }) => {
      React.useEffect(() => {
        const flush = () => mockPendingDocumentMetaFlush?.();

        onRegisterPendingMetaFlush?.(flush);
        return () => onRegisterPendingMetaFlush?.(null);
      }, [onRegisterPendingMetaFlush]);

      return (
        <div data-testid='mock-template-document' data-content-padding={contentPadding}>
          {rowId}
        </div>
      );
    },
  };
});

const databaseId = 'database-id';
const databaseDocId = '40000000-0000-4000-8000-000000000004';
const viewId = 'grid-view';
const nameFieldId = 'name-field';

function setup() {
  const databaseDoc = new Y.Doc({ guid: databaseDocId }) as YDoc;
  const database = new Y.Map() as YDatabase;
  const fields = new Y.Map<YDatabaseField>();
  const nameField = new Y.Map() as YDatabaseField;
  const views = new Y.Map<YDatabaseView>();
  const view = new Y.Map() as YDatabaseView;

  nameField.set(YjsDatabaseKey.id, nameFieldId);
  nameField.set(YjsDatabaseKey.name, 'Name');
  nameField.set(YjsDatabaseKey.type, FieldType.RichText);
  nameField.set(YjsDatabaseKey.is_primary, true);
  fields.set(nameFieldId, nameField);
  view.set(YjsDatabaseKey.name, 'Tasks');
  view.set(YjsDatabaseKey.layout, DatabaseViewLayout.Grid);
  view.set(YjsDatabaseKey.row_orders, new Y.Array());
  view.set(YjsDatabaseKey.filters, new Y.Array());
  view.set(YjsDatabaseKey.layout_settings, new Y.Map());
  views.set(viewId, view);
  database.set(YjsDatabaseKey.id, databaseId);
  database.set(YjsDatabaseKey.fields, fields);
  database.set(YjsDatabaseKey.views, views);
  database.set(YjsDatabaseKey.metas, new Y.Map());
  databaseDoc.getMap(YjsEditorKey.data_section).set(YjsEditorKey.database, database);

  const rows = new Map<string, YDoc>();
  const createRow = jest.fn(async (key: string) => {
    const existing = rows.get(key);

    if (existing) return existing;
    const row = new Y.Doc({ guid: key }) as YDoc;

    rows.set(key, row);
    return row;
  });
  const createRowDocument = jest.fn(async () => new Uint8Array([1]));
  const updatePage = jest.fn(async () => undefined);
  const navigateToRow = jest.fn();
  const context: DatabaseContextState = {
    readOnly: false,
    databaseDoc,
    databasePageId: viewId,
    activeViewId: viewId,
    rowMap: {},
    workspaceId: 'workspace-id',
    createRow,
    createRowDocument,
    updatePage,
    navigateToRow,
  };

  const Wrapper = ({ children }: { children: ReactNode }) => (
    <AFConfigContext.Provider
      value={{ isAuthenticated: true, updateCurrentUser: async () => undefined, openLoginModal: () => undefined }}
    >
      <DatabaseContext.Provider value={context}>{children}</DatabaseContext.Provider>
    </AFConfigContext.Provider>
  );

  return { Wrapper, context, database, view, rows, createRow, createRowDocument, updatePage, navigateToRow };
}

describe('DatabaseTemplateButton variants (WP09 §1.3)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockPendingDocumentMetaFlush = undefined;
  });

  it('draws the icon variant as a 24px accent "+ ▾" split button for widget headers', () => {
    const { Wrapper } = setup();

    render(<DatabaseTemplateButton variant='icon' />, { wrapper: Wrapper });

    const split = screen.getByTestId('database-template-split-button');

    expect(split.getAttribute('data-variant')).toBe('icon');
    expect(split.getAttribute('data-parity-id')).toBe('dash-widget-tool-new');
    expect(split.className).toContain('h-6');
    expect(split.className).toContain('rounded-200');
    expect(split.className).toContain('bg-dash-accent');
    const create = screen.getByTestId('database-new-row-button');

    // A 24×24 "+" named "New", a 1×12 divider, a 20×24 chevron (45 wide in all).
    expect(create.getAttribute('aria-label')).toBe('New');
    expect(create.className).toContain('h-6');
    expect(create.className).toContain('w-6');
    expect(create.textContent).toBe('');
    expect(create.querySelector('[data-parity-id="dash-widget-tool-new__icon"]')).not.toBeNull();
    const divider = create.nextElementSibling as HTMLElement;

    expect(divider.className).toContain('h-3');
    expect(divider.className).toContain('w-px');
    const chevron = screen.getByTestId('database-template-menu-trigger');

    expect(chevron.getAttribute('aria-label')).toBe('Open database templates');
    expect(chevron.className).toContain('h-6');
    expect(chevron.className).toContain('w-5');
    expect(chevron.querySelector('[data-parity-id="dash-widget-tool-new__chevron"]')).not.toBeNull();
  });

  it('opens the templates menu from the chevron of the icon variant', async () => {
    const { Wrapper } = setup();

    render(<DatabaseTemplateButton variant='icon' />, { wrapper: Wrapper });
    fireEvent.keyDown(screen.getByTestId('database-template-menu-trigger'), { key: 'ArrowDown' });
    await waitFor(() => expect(screen.getByTestId('database-template-menu')).toBeTruthy());
  });

  it('keeps the text "New ▾" in a page toolbar, and `compact` as an alias of the compact variant', () => {
    const { Wrapper } = setup();
    const { unmount } = render(<DatabaseTemplateButton />, { wrapper: Wrapper });

    expect(screen.getByTestId('database-template-split-button').getAttribute('data-variant')).toBe('default');
    expect(screen.getByTestId('database-template-split-button').className).toContain('h-7');
    expect(screen.getByTestId('database-new-row-button').textContent).toBe('New');
    unmount();

    render(<DatabaseTemplateButton compact />, { wrapper: Wrapper });
    expect(screen.getByTestId('database-template-split-button').getAttribute('data-variant')).toBe('compact');
    expect(screen.getByTestId('database-template-split-button').className).toContain('h-6');
  });
});
