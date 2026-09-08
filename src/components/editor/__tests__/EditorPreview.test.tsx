import { render, screen } from '@testing-library/react';
import * as Y from 'yjs';

import { BlockType, YDoc } from '@/application/types';
import CollaborativeEditor from '@/components/editor/CollaborativeEditor';
import { DatabaseBlock } from '@/components/editor/components/blocks/database/DatabaseBlock';
import { useDocumentLoader } from '@/components/editor/components/blocks/database/hooks/useDocumentLoader';
import { Heading } from '@/components/editor/components/blocks/heading/Heading';
import SimpleTableCell from '@/components/editor/components/blocks/simple-table/SimpleTableCell';
import { Editor } from '@/components/editor/Editor';
import { DatabaseNode, HeadingNode, SimpleTableCellBlockNode } from '@/components/editor/editor.type';

jest.mock('@/components/editor/editor.scss', () => ({}));
jest.mock('@/components/editor/CollaborativeEditor', () => ({ __esModule: true, default: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));
jest.mock('slate-react', () => ({
  useReadOnly: () => true,
  useSlateStatic: () => ({ isElementReadOnly: () => true }),
}));
jest.mock('@/components/database/hooks', () => ({ useEmbeddedVisibleViewIds: jest.fn() }));
jest.mock('@/components/editor/components/blocks/database/components/DatabaseContent', () => ({
  DatabaseContent: jest.fn(),
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useDocumentLoader', () => ({
  useDocumentLoader: jest.fn(),
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useDatabaseDeletionStatus', () => ({
  useDatabaseDeletionStatus: jest.fn(),
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useEmbeddedDatabasePermissions', () => ({
  EmbeddedDatabasePermissionsResolver: jest.fn(),
  resolveEmbeddedDatabaseCollabId: jest.fn(),
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useResizePositioning', () => ({
  useResizePositioning: jest.fn(),
}));
jest.mock('@/components/editor/components/blocks/database/hooks/useViewMeta', () => ({ useViewMeta: jest.fn() }));
jest.mock('@/components/editor/components/blocks/database/hooks/useViewSelection', () => ({
  useViewSelection: jest.fn(),
}));
jest.mock('@/components/editor/components/blocks/simple-table/SimpleTableColumnResizer', () => ({
  SimpleTableColumnResizer: jest.fn(),
}));

const mockCollaborativeEditor = CollaborativeEditor as jest.MockedFunction<typeof CollaborativeEditor>;

describe('Editor previews', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    BlockType.GridBlock,
    BlockType.BoardBlock,
    BlockType.CalendarBlock,
    BlockType.DatabaseGalleryBlock,
    BlockType.ListBlock,
    BlockType.ChartBlock,
    BlockType.FeedBlock,
  ])('renders nested %s databases as placeholders without loading them', (type) => {
    const doc = new Y.Doc({ guid: 'row-document' }) as YDoc;
    const databaseNode = {
      blockId: 'linked-database',
      type,
      data: { database_id: 'parent-database', view_ids: ['parent-feed'] },
      children: [{ text: '' }],
    } as DatabaseNode;

    mockCollaborativeEditor.mockImplementation(() => (
      <DatabaseBlock node={databaseNode}>
        <span>Slate children</span>
      </DatabaseBlock>
    ));
    const loadView = jest.fn();

    render(<Editor doc={doc} viewId='row-document' workspaceId='workspace' readOnly preview loadView={loadView} />);
    expect(screen.getByTestId('database-preview-placeholder')).toBeTruthy();
    expect(useDocumentLoader).not.toHaveBeenCalled();
    expect(loadView).not.toHaveBeenCalled();
  });

  it('isolates heading and table-cell identities across two previews and the row-detail editor', () => {
    const doc = new Y.Doc() as YDoc;
    const heading: HeadingNode = {
      blockId: 'heading-block',
      type: BlockType.HeadingBlock,
      data: { level: 1 },
      children: [{ text: 'Heading' }],
    };
    const cell: SimpleTableCellBlockNode = { blockId: 'cell-block', type: BlockType.SimpleTableCellBlock, children: [] };

    mockCollaborativeEditor.mockImplementation(() => (
      <>
        <Heading node={heading}>Heading</Heading>
        <table>
          <tbody>
            <tr>
              <SimpleTableCell node={cell} />
            </tr>
          </tbody>
        </table>
      </>
    ));

    render(
      <>
        <section data-testid='preview-1'>
          <Editor doc={doc} viewId='row-document' workspaceId='workspace' readOnly preview />
        </section>
        <section data-testid='preview-2'>
          <Editor doc={doc} viewId='row-document' workspaceId='workspace' readOnly preview />
        </section>
        <section data-testid='row-detail'>
          <Editor doc={doc} viewId='row-document' workspaceId='workspace' readOnly={false} />
        </section>
      </>
    );

    const detail = screen.getByTestId('row-detail');
    const headings = Array.from(document.querySelectorAll('.heading'));
    const cells = Array.from(document.querySelectorAll('td'));

    expect(new Set(headings.map((element) => element.id)).size).toBe(3);
    expect(new Set(cells.map((element) => element.getAttribute('data-block-cell'))).size).toBe(3);
    expect(document.getElementById('heading-heading-block')).toBe(detail.querySelector('.heading'));
    expect(document.querySelector('td[data-block-cell="cell-block"]')).toBe(detail.querySelector('td'));
  });
});
