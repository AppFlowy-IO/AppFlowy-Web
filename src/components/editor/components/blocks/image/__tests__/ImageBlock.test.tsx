import { render, screen, waitFor } from '@testing-library/react';

import { BlockType, ImageBlockData } from '@/application/types';
import { ImageBlock } from '@/components/editor/components/blocks/image/ImageBlock';
import { ImageBlockNode } from '@/components/editor/editor.type';

const mockGetStoredFile = jest.fn();
const mockCleanup = jest.fn();
const mockReleaseUrl = jest.fn();

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('slate-react', () => ({
  ReactEditor: {
    findPath: jest.fn(),
    focus: jest.fn(),
  },
  useReadOnly: () => false,
  useSelected: () => false,
  useSlateStatic: () => ({
    isElementReadOnly: () => false,
    select: jest.fn(),
    start: jest.fn(),
  }),
}));

jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({
    uploadFile: jest.fn(),
    viewId: 'view-id',
    workspaceId: 'workspace-id',
  }),
}));

jest.mock('@/components/editor/components/block-popover/BlockPopoverContext', () => ({
  usePopoverContext: () => ({ openPopover: jest.fn() }),
}));

jest.mock('@/components/editor/utils/file-url', () => ({
  constructFileUrl: (url?: string) => url || '',
}));

jest.mock('@/utils/file', () => ({
  FileHandler: jest.fn().mockImplementation(() => ({
    cleanup: mockCleanup,
    getStoredFile: mockGetStoredFile,
    releaseUrl: mockReleaseUrl,
  })),
}));

jest.mock('@/components/editor/components/blocks/image/ImageRender', () => ({
  __esModule: true,
  default: ({ localUrl, node }: { localUrl?: string; node: ImageBlockNode }) => (
    <div
      data-testid='image-render'
      data-display-url={localUrl || node.data.url}
      data-local-url={localUrl}
      data-url={node.data.url}
    />
  ),
}));

jest.mock('@/components/editor/components/blocks/image/ImageEmpty', () => ({
  __esModule: true,
  default: () => <div data-testid='image-empty' />,
}));

function imageNode(data: ImageBlockData): ImageBlockNode {
  return {
    blockId: 'image-block-id',
    children: [{ text: '' }],
    data,
    type: BlockType.ImageBlock,
  };
}

describe('ImageBlock upload status', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCleanup.mockResolvedValue(undefined);
    mockGetStoredFile.mockResolvedValue({ url: 'blob:local-preview' });
  });

  it('keeps the rendered local preview when the pending upload succeeds', async () => {
    const retryLocalUrl = 'stored-file-id';
    const { rerender } = render(
      <ImageBlock
        node={imageNode({
          pending_upload_id: 'pending-upload-id',
          retry_local_url: retryLocalUrl,
          url: '',
        })}
      >
        <span />
      </ImageBlock>
    );

    expect((await screen.findByTestId('image-render')).getAttribute('data-display-url')).toBe('blob:local-preview');

    rerender(
      <ImageBlock
        node={imageNode({
          pending_upload_id: '',
          retry_local_url: '',
          url: 'https://example.com/uploaded-image.png',
        })}
      >
        <span />
      </ImageBlock>
    );

    await waitFor(() => {
      expect(screen.getByTestId('image-render').getAttribute('data-display-url')).toBe('blob:local-preview');
    });
    expect(screen.queryByTestId('image-upload-pending')).toBeNull();
    expect(screen.queryByText('button.uploadFailed')).toBeNull();

    rerender(
      <ImageBlock
        node={imageNode({
          pending_upload_id: '',
          retry_local_url: '',
          url: 'https://example.com/replacement-image.png',
        })}
      >
        <span />
      </ImageBlock>
    );

    await waitFor(() => {
      expect(screen.getByTestId('image-render').getAttribute('data-display-url')).toBe(
        'https://example.com/replacement-image.png'
      );
    });
    expect(mockCleanup).toHaveBeenCalledWith(retryLocalUrl);
  });

  it('shows uploading instead of a false failure while the remote upload is pending', async () => {
    const retryLocalUrl = 'stored-file-id';
    const { rerender } = render(
      <ImageBlock
        node={imageNode({
          pending_upload_id: 'pending-upload-id',
          retry_local_url: retryLocalUrl,
          url: '',
        })}
      >
        <span />
      </ImageBlock>
    );

    expect((await screen.findByTestId('image-render')).getAttribute('data-local-url')).toBe('blob:local-preview');
    expect(screen.getByTestId('image-upload-pending').textContent).toContain('fileDropzone.uploading');
    expect(screen.queryByText('button.uploadFailed')).toBeNull();

    rerender(
      <ImageBlock
        node={imageNode({
          pending_upload_id: '',
          retry_local_url: retryLocalUrl,
          url: '',
        })}
      >
        <span />
      </ImageBlock>
    );

    await waitFor(() => expect(screen.getByText('button.uploadFailed')).toBeTruthy());
    expect(screen.queryByTestId('image-upload-pending')).toBeNull();
  });

  it('releases the preview without deleting retry data when a failed block unmounts', async () => {
    const retryLocalUrl = 'stored-file-id';
    const { unmount } = render(
      <ImageBlock
        node={imageNode({
          pending_upload_id: '',
          retry_local_url: retryLocalUrl,
          url: '',
        })}
      >
        <span />
      </ImageBlock>
    );

    await screen.findByTestId('image-render');
    unmount();

    expect(mockReleaseUrl).toHaveBeenCalledWith(retryLocalUrl);
    expect(mockCleanup).not.toHaveBeenCalled();
  });
});
