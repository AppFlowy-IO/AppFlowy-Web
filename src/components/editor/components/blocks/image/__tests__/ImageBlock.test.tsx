import { fireEvent, render, screen, waitFor } from '@testing-library/react';

import { BlockType, ImageBlockData, ImageType } from '@/application/types';
import { ImageBlock } from '@/components/editor/components/blocks/image/ImageBlock';
import { ImageBlockNode } from '@/components/editor/editor.type';

const mockGetStoredFile = jest.fn();
const mockCleanup = jest.fn();
const mockReleaseUrl = jest.fn();
const mockOpenPopover = jest.fn();
const mockSetBlockData = jest.fn();
let mockReadOnly = false;
let mockElementReadOnly = false;

jest.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

jest.mock('slate-react', () => ({
  ReactEditor: {
    findPath: jest.fn(),
    focus: jest.fn(),
  },
  useReadOnly: () => mockReadOnly,
  useSelected: () => false,
  useSlateStatic: () => ({
    isElementReadOnly: () => mockElementReadOnly,
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
  usePopoverContext: () => ({ openPopover: mockOpenPopover }),
}));

jest.mock('@/application/slate-yjs/command', () => ({
  CustomEditor: { setBlockData: (...args: unknown[]) => mockSetBlockData(...args) },
}));

jest.mock('@/utils/runtime-config', () => ({
  getConfigValue: (key: string) => (key === 'APPFLOWY_BASE_URL' ? 'https://app.flowy.io' : ''),
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

beforeEach(() => {
  jest.clearAllMocks();
  mockReadOnly = false;
  mockElementReadOnly = false;
  mockCleanup.mockResolvedValue(undefined);
  mockGetStoredFile.mockResolvedValue({ url: 'blob:local-preview' });
});

describe('ImageBlock upload status', () => {
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

describe('ImageBlock device-local images', () => {
  const localPath =
    '/Users/example/Library/Application Support/com.appflowy.appflowy.flutter/data/images/82fb925a-2e90-4f75-b58a-34c9b6b53c27.png';

  it.each([undefined, ImageType.Local, ImageType.Internal])(
    'shows an unavailable message for a desktop path with image_type %s without starting image loading',
    (imageType) => {
      const node = imageNode({ image_type: imageType, url: localPath });

      render(
        <ImageBlock node={node}>
          <span />
        </ImageBlock>
      );

      expect(screen.getByText('editor.imageLocalFileUnavailable')).toBeTruthy();
      expect(screen.queryByTestId('image-render')).toBeNull();
      expect(screen.queryByTestId('image-empty')).toBeNull();
      expect(screen.queryByTestId('image-upload-pending')).toBeNull();
      expect(screen.queryByText('button.retry')).toBeNull();
      expect(screen.queryByText(localPath)).toBeNull();
      expect(node.data.url).toBe(localPath);
      expect(mockSetBlockData).not.toHaveBeenCalled();
    }
  );

  it('opens the existing image picker to replace an unavailable local image', () => {
    render(
      <ImageBlock node={imageNode({ url: localPath })}>
        <span />
      </ImageBlock>
    );

    fireEvent.click(screen.getByRole('button', { name: 'editor.replaceImage' }));

    expect(mockOpenPopover).toHaveBeenCalledTimes(1);
    expect(mockOpenPopover).toHaveBeenCalledWith('image-block-id', BlockType.ImageBlock, expect.any(HTMLElement));
    expect(mockSetBlockData).not.toHaveBeenCalled();
  });

  it.each([
    { readOnly: true, elementReadOnly: false },
    { readOnly: false, elementReadOnly: true },
  ])('offers no replacement action when editing is unavailable: %o', ({ readOnly, elementReadOnly }) => {
    mockReadOnly = readOnly;
    mockElementReadOnly = elementReadOnly;

    render(
      <ImageBlock node={imageNode({ url: localPath })}>
        <span />
      </ImageBlock>
    );

    const message = screen.getByText('editor.imageLocalFileUnavailable');

    expect(screen.queryByRole('button', { name: 'editor.replaceImage' })).toBeNull();
    fireEvent.click(message);
    expect(mockOpenPopover).not.toHaveBeenCalled();
    expect(mockSetBlockData).not.toHaveBeenCalled();
  });

  it.each([undefined, ImageType.Local])('renders HTTPS images even when image_type is %s', (imageType) => {
    const url = 'https://example.com/image.png';

    render(
      <ImageBlock node={imageNode({ image_type: imageType, url })}>
        <span />
      </ImageBlock>
    );

    expect(screen.getByTestId('image-render').getAttribute('data-display-url')).toBe(url);
    expect(screen.queryByText('editor.imageLocalFileUnavailable')).toBeNull();
  });

  it('renders a synchronized cloud URL when the original device uploads the local image', () => {
    const originalNode = imageNode({ image_type: ImageType.Local, url: localPath });
    const { rerender } = render(
      <ImageBlock node={originalNode}>
        <span />
      </ImageBlock>
    );

    expect(screen.getByText('editor.imageLocalFileUnavailable')).toBeTruthy();

    const url = 'https://app.flowy.io/api/file_storage/workspace-id/v1/blob/view-id/uploaded-file-id';

    rerender(
      <ImageBlock node={imageNode({ image_type: ImageType.Internal, url })}>
        <span />
      </ImageBlock>
    );

    expect(screen.getByTestId('image-render').getAttribute('data-display-url')).toBe(url);
    expect(screen.queryByText('editor.imageLocalFileUnavailable')).toBeNull();
    expect(originalNode.data.url).toBe(localPath);
    expect(mockSetBlockData).not.toHaveBeenCalled();
  });
});
