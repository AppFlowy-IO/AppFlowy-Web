import { render, screen } from '@testing-library/react';

import { BlockType } from '@/application/types';
import ImageRender from '@/components/editor/components/blocks/image/ImageRender';
import { ImageBlockNode } from '@/components/editor/editor.type';

jest.mock('slate-react', () => ({
  useReadOnly: () => false,
  useSlateStatic: () => ({ isElementReadOnly: () => false }),
}));

jest.mock('@/components/editor/components/blocks/image/Img', () => ({
  __esModule: true,
  default: ({ url }: { url: string }) => <div data-testid='image-source' data-url={url} />,
}));

jest.mock('@/components/editor/components/blocks/image/ImageResizer', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/editor/components/blocks/image/ImageToolbar', () => ({
  __esModule: true,
  default: () => null,
}));

describe('ImageRender', () => {
  it('prefers an existing local preview over the newly uploaded remote URL', () => {
    const node: ImageBlockNode = {
      blockId: 'image-block-id',
      children: [{ text: '' }],
      data: { url: 'https://example.com/uploaded-image.png' },
      type: BlockType.ImageBlock,
    };

    render(<ImageRender localUrl='blob:local-preview' node={node} selected={false} />);

    expect(screen.getByTestId('image-source').getAttribute('data-url')).toBe('blob:local-preview');
  });
});
