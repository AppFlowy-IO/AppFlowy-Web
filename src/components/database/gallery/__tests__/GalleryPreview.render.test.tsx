import { render, screen, waitFor } from '@testing-library/react';

import { useCellSelector, useDatabaseContext } from '@/application/database-yjs';
import type { RowMeta } from '@/application/database-yjs';
import { GalleryCardPreview } from '@/application/types';

import GalleryPreview from '../GalleryPreview';

jest.mock('@/application/database-yjs', () => ({
  useCellSelector: jest.fn(),
  useDatabaseContext: jest.fn(),
}));
jest.mock('@/application/row-document/lifecycle', () => ({
  rowDocumentIdFromRowId: (rowId: string) => `document-${rowId}`,
}));
jest.mock('@/components/_shared/image-render/ImageRender', () => ({
  __esModule: true,
  default: ({ src }: { src: string }) => <img alt='' src={src} />,
}));

const mockUseCellSelector = useCellSelector as jest.MockedFunction<typeof useCellSelector>;
const mockUseDatabaseContext = useDatabaseContext as jest.MockedFunction<typeof useDatabaseContext>;

describe('GalleryPreview subscriptions', () => {
  const loadRowDocument = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    loadRowDocument.mockResolvedValue(null);
    mockUseCellSelector.mockReturnValue(undefined);
    mockUseDatabaseContext.mockReturnValue({
      databasePageId: 'database-page',
      loadRowDocument,
      workspaceId: 'workspace',
    } as ReturnType<typeof useDatabaseContext>);
  });

  it('waits for non-empty row metadata before loading a Page content document', async () => {
    const { rerender } = render(
      <GalleryPreview fitImage={false} meta={undefined} preview={GalleryCardPreview.PageContent} rowId='row-1' />
    );

    expect(loadRowDocument).not.toHaveBeenCalled();

    rerender(
      <GalleryPreview
        fitImage={false}
        meta={{ isEmptyDocument: false } as RowMeta}
        preview={GalleryCardPreview.PageContent}
        rowId='row-1'
      />
    );

    await waitFor(() => {
      expect(loadRowDocument).toHaveBeenCalledWith('document-row-1');
    });
  });

  it('does not subscribe to a media cell for Page cover previews', () => {
    render(<GalleryPreview fitImage={false} meta={undefined} preview={GalleryCardPreview.PageCover} rowId='row-1' />);

    expect(mockUseCellSelector).not.toHaveBeenCalled();
    expect(screen.getByTestId('gallery-card-preview-row-1').className).toContain('bg-[rgba(31,35,41,0.08)]');
    expect(screen.getByTestId('gallery-card-preview-row-1').className).toContain(
      '[[data-dark-mode=true]_&]:bg-[rgba(89,100,122,0.25)]'
    );
  });
});
