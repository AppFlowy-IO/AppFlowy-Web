import { fireEvent, render, screen } from '@testing-library/react';
import { ReactNode } from 'react';

import { Title } from '../Title';

const mockUpdateCell = jest.fn();
let mockReadOnly = true;
let mockEditorUnavailable = false;
let mockWorkspaceId = 'workspace-1';

jest.mock('@/application/database-yjs', () => ({
  RowMetaKey: { IconId: 'icon_id', CoverId: 'cover_id' },
  useDatabaseContext: () => ({ workspaceId: mockWorkspaceId }),
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
jest.mock('@/components/database/components/cell/text/rich-text/RichTextCellDocument', () => ({
  __esModule: true,
  default: () => null,
}));
// A stand-in for the editor that can also fail to render: the title then
// falls back to its plain-text editor.
jest.mock('@/components/database/components/cell/text/rich-text/load', () => ({
  RichTextCellEditor: ({ value }: { value: string }) => {
    if (mockEditorUnavailable) throw new Error('Failed to fetch dynamically imported module');
    // Like Slate's initialValue, an uncontrolled input owns its draft for
    // its mount lifetime and does not reset it on a prop update.
    return <input data-testid='rich-title-editor' defaultValue={value} />;
  },
}));

beforeEach(() => {
  mockUpdateCell.mockReset();
  mockReadOnly = true;
  mockEditorUnavailable = false;
  mockWorkspaceId = 'workspace-1';
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
    expect(screen.queryByRole('textbox', { name: 'Row title' })).toBeNull();
  });

  it.each(['row', 'field', 'workspace'])('starts a fresh title session when the %s changes', (identity) => {
    const props = { rowId: 'row-1', fieldId: 'field-1', name: 'First row', hasCover: false };
    const { rerender } = render(<Title {...props} />);
    const first = screen.getByTestId<HTMLInputElement>('rich-title-editor');

    fireEvent.change(first, { target: { value: 'Local draft' } });
    rerender(<Title {...props} name='Updated remotely' />);
    expect(screen.getByTestId<HTMLInputElement>('rich-title-editor').value).toBe('Local draft');

    if (identity === 'workspace') mockWorkspaceId = 'workspace-2';
    rerender(
      <Title
        {...props}
        rowId={identity === 'row' ? 'row-2' : props.rowId}
        fieldId={identity === 'field' ? 'field-2' : props.fieldId}
        name='Second row'
      />
    );

    expect(screen.getByTestId<HTMLInputElement>('rich-title-editor').value).toBe('Second row');
    expect(first.isConnected).toBe(false);
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
