import { render, screen } from '@testing-library/react';
import { ReactNode } from 'react';

import { Title } from '../Title';

jest.mock('@/application/database-yjs', () => ({
  RowMetaKey: { IconId: 'icon_id', CoverId: 'cover_id' },
  useDatabaseContext: () => ({}),
  useReadOnly: () => true,
}));
jest.mock('@/application/database-yjs/dispatch', () => ({
  useUpdateCellDispatch: () => jest.fn(),
  useUpdateRowMetaDispatch: () => jest.fn(),
}));
jest.mock('@/components/_shared/cutsom-icon', () => ({
  CustomIconPopover: ({ children }: { children: ReactNode }) => children,
}));
jest.mock('@/components/view-meta/AddIconCover', () => ({ __esModule: true, default: () => null }));
jest.mock('@/components/database/components/cell/text/rich-text/load', () => ({
  RichTextCellContent: ({ text }: { text: string }) => <div data-testid='rich-text-cell-content'>{text}</div>,
  RichTextCellEditor: () => null,
}));

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
