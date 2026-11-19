import { fireEvent, render, screen } from '@testing-library/react';

import { BlockType } from '@/application/types';
import ImageRender from '@/components/editor/components/blocks/image/ImageRender';
import { ImageBlockNode } from '@/components/editor/editor.type';
import { openUrl } from '@/utils/url';

const mockOpenPageModal = jest.fn();
const mockNavigateToView = jest.fn();
let mockHasNavigation = false;
let mockHasModal = true;
let mockReadOnly = false;

jest.mock('@/utils/url', () => ({ openUrl: jest.fn() }));
jest.mock('react-i18next', () => ({ useTranslation: () => ({ t: (key: string) => key }) }));

jest.mock('slate-react', () => ({
  useReadOnly: () => mockReadOnly,
  useSlateStatic: () => ({ isElementReadOnly: () => false }),
}));

jest.mock('@/components/editor/components/blocks/image/Img', () => ({
  __esModule: true,
  default: ({ url }: { url: string }) => <div data-testid='image-source' data-url={url} />,
}));

jest.mock('@/components/editor/components/blocks/image/ImageResizeHandle', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/editor/components/blocks/image/ImageToolbar', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/editor/EditorContext', () => ({
  useEditorContext: () => ({
    openPageModal: mockHasModal ? mockOpenPageModal : undefined,
    navigateToView: mockHasNavigation ? mockNavigateToView : undefined,
  }),
}));
beforeEach(() => {
  jest.clearAllMocks();
  mockReadOnly = false;
  mockHasNavigation = false;
  mockHasModal = true;
  global.ResizeObserver = class {
    observe = jest.fn();
    disconnect = jest.fn();
    unobserve = jest.fn();
  };
});

describe('ImageRender', () => {
  it.each([true, false])('uses shared page navigation with or without a page modal (modal: %s)', (hasModal) => {
    mockHasNavigation = true;
    mockHasModal = hasModal;
    const node: ImageBlockNode = {
      blockId: 'image',
      type: BlockType.ImageBlock,
      children: [{ text: '' }],
      data: {
        url: 'https://example.com/image.png',
        link: JSON.stringify({ is_page_link: true, page_id: 'target-page' }),
      },
    };

    render(<ImageRender node={node} />);
    fireEvent.click(screen.getByRole('button', { name: 'web.imageBlock.openLink' }));
    expect(mockNavigateToView).toHaveBeenCalledWith('target-page');
    expect(mockOpenPageModal).not.toHaveBeenCalled();
  });

  it('does not steal focus when mounting a saved caption or receiving one from a collaborator', () => {
    const node: ImageBlockNode = {
      blockId: 'image',
      type: BlockType.ImageBlock,
      children: [{ text: '' }],
      data: { url: 'https://example.com/image.png', caption: 'Saved caption' },
    };
    const { rerender } = render(
      <>
        <input aria-label='Other editor' />
        <ImageRender node={node} />
      </>
    );
    const input = screen.getByRole('textbox', { name: 'Other editor' });

    expect(document.activeElement).not.toBe(screen.getByRole('textbox', { name: 'web.imageBlock.caption' }));
    rerender(
      <>
        <input aria-label='Other editor' />
        <ImageRender node={{ ...node, data: { ...node.data, caption: undefined } }} />
      </>
    );
    input.focus();
    rerender(
      <>
        <input aria-label='Other editor' />
        <ImageRender node={{ ...node, data: { ...node.data, caption: 'Remote caption' } }} />
      </>
    );
    expect(document.activeElement).toBe(input);
  });

  it.each([false, true])('opens linked images in editable and read-only documents (readOnly: %s)', (readOnly) => {
    mockReadOnly = readOnly;
    const node: ImageBlockNode = {
      blockId: 'linked-image',
      type: BlockType.ImageBlock,
      children: [{ text: '' }],
      data: {
        url: 'https://example.com/image.png',
        link: JSON.stringify({ is_page_link: false, url: 'https://example.com/destination' }),
      },
    };
    const { rerender } = render(<ImageRender node={node} />);

    fireEvent.click(screen.getByRole('button', { name: 'web.imageBlock.openLink' }));
    expect(openUrl).toHaveBeenCalledWith('https://example.com/destination', '_blank', 'noopener,noreferrer');
    rerender(
      <ImageRender
        node={{ ...node, data: { ...node.data, link: JSON.stringify({ is_page_link: true, page_id: 'target-page' }) } }}
      />
    );
    fireEvent.click(screen.getByRole('button', { name: 'web.imageBlock.openLink' }));
    expect(mockOpenPageModal).toHaveBeenCalledWith('target-page');
    expect(openUrl).toHaveBeenCalledTimes(1);
  });

  it('does not create a click target for unsafe or missing links', () => {
    const node: ImageBlockNode = {
      blockId: 'unlinked-image',
      type: BlockType.ImageBlock,
      children: [{ text: '' }],
      data: { url: 'https://example.com/image.png', link: JSON.stringify({ url: 'javascript:alert(1)' }) },
    };
    const { rerender } = render(<ImageRender node={node} />);

    expect(screen.queryByRole('button', { name: 'web.imageBlock.openLink' })).toBeNull();
    rerender(<ImageRender node={{ ...node, data: { url: node.data.url } }} />);
    expect(screen.queryByRole('button', { name: 'web.imageBlock.openLink' })).toBeNull();
  });

  it('prefers an existing local preview over the newly uploaded remote URL', () => {
    const node: ImageBlockNode = {
      blockId: 'image-block-id',
      children: [{ text: '' }],
      data: { url: 'https://example.com/uploaded-image.png' },
      type: BlockType.ImageBlock,
    };

    render(<ImageRender localUrl='blob:local-preview' node={node} />);

    expect(screen.getByTestId('image-source').getAttribute('data-url')).toBe('blob:local-preview');
  });
});
