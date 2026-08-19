import { render, screen } from '@testing-library/react';
import type React from 'react';
import * as Y from 'yjs';

import { DatabaseContext, DatabaseContextState, FieldType } from '@/application/database-yjs';
import {
  FileMediaCell as FileMediaCellType,
  FileMediaCellDataItem,
  FileMediaType,
  FileMediaUploadType,
} from '@/application/database-yjs/cell.type';
import { YDatabaseField, YjsDatabaseKey } from '@/application/types';

import FileMediaCell from '../file-media/FileMediaCell';

jest.mock('@/application/database-yjs/selector', () => ({
  ...jest.requireActual('@/application/database-yjs/selector'),
  useFieldSelector: jest.fn(),
}));

jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateCellDispatch: jest.fn(),
}));

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useFieldSelector } = require('@/application/database-yjs/selector');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { useUpdateCellDispatch } = require('@/application/database-yjs/dispatch');

const fieldId = 'field-id';
const rowId = 'row-id';

function createMediaField(): YDatabaseField {
  const doc = new Y.Doc();
  const field = doc.getMap('field') as YDatabaseField;

  field.set(YjsDatabaseKey.id, fieldId);
  field.set(YjsDatabaseKey.name, 'Files & media');
  field.set(YjsDatabaseKey.type, FieldType.Media);
  return field;
}

const mediaItem: FileMediaCellDataItem = {
  id: 'file-1',
  name: 'Invoice-114489.pdf',
  url: 'https://example.com/Invoice-114489.pdf',
  file_type: FileMediaType.Document,
  upload_type: FileMediaUploadType.CloudMedia,
};

const contextValue = {
  readOnly: false,
  databasePageId: 'view-id',
  activeViewId: 'view-id',
  workspaceId: 'workspace-id',
  rowMap: {},
} as unknown as DatabaseContextState;

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <DatabaseContext.Provider value={contextValue}>{children}</DatabaseContext.Provider>
);

/**
 * The cell renders the file grid above the "add file" row, and only when it
 * reads at least one file out of the payload.
 */
function hasFileGrid(container: HTMLElement) {
  return (container.firstElementChild?.children.length ?? 0) > 1;
}

function renderCell(data: unknown) {
  return render(
    <FileMediaCell
      cell={{ fieldType: FieldType.Media, createdAt: 0, lastModified: 0, data } as unknown as FileMediaCellType}
      fieldId={fieldId}
      rowId={rowId}
    />,
    { wrapper }
  );
}

describe('row-detail FileMediaCell', () => {
  beforeAll(() => {
    // jsdom has no ResizeObserver; the media grid measures itself with one.
    global.ResizeObserver = class {
      observe() {
        // no-op
      }

      unobserve() {
        // no-op
      }

      disconnect() {
        // no-op
      }
    } as unknown as typeof ResizeObserver;
  });

  beforeEach(() => {
    (useFieldSelector as jest.Mock).mockReturnValue({ field: createMediaField(), clock: 0 });
    (useUpdateCellDispatch as jest.Mock).mockReturnValue(jest.fn());
  });

  it('renders a file grid for the files it was given', () => {
    const { container } = renderCell([mediaItem]);

    expect(hasFileGrid(container)).toBe(true);
  });

  // Switching a Text property to Files & media leaves the old string in the
  // cell for a moment; rendering it used to throw and take down the whole page.
  it('renders empty when the cell still holds the previous type\'s text', () => {
    const { container } = renderCell('Invoice-114489.pdf');

    expect(hasFileGrid(container)).toBe(false);
    expect(screen.getByText('grid.media.addFileOrMedia')).toBeTruthy();
  });

  it('renders empty for other payloads that are not a file list', () => {
    expect(() => renderCell(undefined)).not.toThrow();
    expect(() => renderCell(null)).not.toThrow();
    expect(() => renderCell(42)).not.toThrow();
  });
});
