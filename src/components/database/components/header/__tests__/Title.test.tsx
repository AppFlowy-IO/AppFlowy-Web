import { fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';

import { Title } from '../Title';

const mockUpdateCell = jest.fn();
let mockReadOnly = true;
let mockEditorUnavailable = false;

jest.mock('@/application/database-yjs', () => ({
  RowMetaKey: { IconId: 'icon_id', CoverId: 'cover_id' },
  useDatabaseContext: () => ({}),
  useReadOnly: () => mockReadOnly,
}));
jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateCellDispatch: () => mockUpdateCell,
  useUpdateRowMetaDispatch: () => jest.fn(),
}));
jest.mock('@/components/_shared/cutsom-icon', () => ({
  CustomIconPopover: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('@/components/view-meta/AddIconCover', () => ({ __esModule: true, default: () => null }));
// The editor loads on first use; rendering it throws when it could not be
// loaded (see rich-text/__tests__/load-failure.test.tsx).
jest.mock('@/components/database/components/cell/text/rich-text/load', () => ({
  RichTextCellDocument: () => null,
  RichTextCellEditor: () => {
    if (mockEditorUnavailable) throw new Error('Failed to fetch dynamically imported module');
    return <div data-testid='rich-title-editor' />;
  },
}));

beforeEach(() => {
  mockUpdateCell.mockReset();
  mockReadOnly = true;
  mockEditorUnavailable = false;
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('editable row title', () => {
  beforeEach(() => {
    mockReadOnly = false;
  });

  it('edits with the rich editor', () => {
    render(<Title rowId='row-1' fieldId='field-1' name='My row' hasCover={false} />);

    expect(screen.getByTestId('rich-title-editor')).toBeTruthy();
    expect(screen.queryByRole('textbox')).toBeNull();
  });

  it('edits as plain text, without taking the focus, when the rich editor cannot be loaded', () => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    mockEditorUnavailable = true;
    const onEdited = jest.fn();

    render(<Title rowId='row-1' fieldId='field-1' name='My row' hasCover={false} onEdited={onEdited} />);

    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Row title' });

    expect(textarea.getAttribute('data-testid')).toBe('row-title-input');
    expect(textarea.value).toBe('My row');
    expect(document.activeElement).not.toBe(textarea);

    fireEvent.change(textarea, { target: { value: 'My row!' } });
    expect(mockUpdateCell).toHaveBeenCalledWith('My row!');
    expect(onEdited).toHaveBeenCalledWith('My row!');
  });

  it("edits a row template's name as plain text, focused", () => {
    render(<Title rowId='row-1' fieldId='field-1' name='Template' hasCover={false} templateStyle />);

    const textarea = screen.getByRole<HTMLTextAreaElement>('textbox', { name: 'Template name' });

    expect(document.activeElement).toBe(textarea);
    expect(screen.queryByTestId('rich-title-editor')).toBeNull();

    fireEvent.change(textarea, { target: { value: 'Template 2' } });
    expect(mockUpdateCell).toHaveBeenCalledWith('Template 2');
  });
});

describe('read-only row title', () => {
  it("is the page's heading, named by its text", () => {
    render(<Title rowId='row-1' fieldId='field-1' name='My row' hasCover={false} />);

    const heading = screen.getByRole('heading', { level: 1, name: 'My row' });

    expect(heading.getAttribute('data-testid')).toBe('row-title-input');
    expect(heading.hasAttribute('aria-label')).toBe(false);
  });

  it('keeps its formatting inside the heading', () => {
    render(
      <Title
        rowId='row-1'
        fieldId='field-1'
        name='Big idea'
        richText={[{ insert: 'Big ' }, { insert: 'idea', attributes: { bold: true } }]}
        hasCover={false}
      />
    );

    expect(
      screen.getByRole('heading', { level: 1 }).querySelector('[data-testid="rich-text-cell-content"]')
    ).not.toBeNull();
  });
});
