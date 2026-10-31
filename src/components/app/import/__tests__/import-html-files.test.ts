import { Node } from 'slate';
import * as Y from 'yjs';

import { getCollab, updateCollab } from '@/application/services/js-services/http/collab-api';
import { uploadFileMultipart } from '@/application/services/js-services/http/file-api';
import { yDocToSlateContent } from '@/application/slate-yjs/utils/convert';
import { createEmptyDocument } from '@/application/slate-yjs/utils/yjs';
import { BlockType, ImageType } from '@/application/types';
import { importHtmlFiles } from '@/components/app/import/import-service';
import { parseHTML } from '@/components/editor/parsers/html-parser';
import type { ParsedBlock } from '@/components/editor/parsers/types';

jest.mock('@/application/services/js-services/http/collab-api', () => ({
  getCollab: jest.fn(),
  updateCollab: jest.fn(),
}));
jest.mock('@/application/services/js-services/http/file-api', () => ({ uploadFileMultipart: jest.fn() }));
jest.mock('@/application/services/js-services/http/import-api', () => ({}));
jest.mock('@/components/editor/parsers/html-parser', () => ({ parseHTML: jest.fn() }));
jest.mock('@/utils/md5', () => ({ calculateMd5: jest.fn() }));

const paragraph: ParsedBlock = {
  type: BlockType.Paragraph,
  data: {},
  text: 'Article 中文 — café.',
  formats: [{ start: 0, end: 7, type: 'bold' }],
  children: [],
};

function htmlFile(name: string) {
  return Object.assign(new File(['<p>Article</p>'], name), { text: jest.fn().mockResolvedValue('<p>Article</p>') });
}

describe('importHtmlFiles', () => {
  const createPage = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.mocked(parseHTML).mockReturnValue([paragraph]);
    createPage.mockResolvedValue({ view_id: 'new-page' });
    const doc = createEmptyDocument();

    (getCollab as jest.Mock).mockResolvedValue({ data: Y.encodeStateAsUpdate(doc) });
    doc.destroy();
    jest.mocked(updateCollab).mockResolvedValue(undefined);
  });

  function savedContent() {
    const doc = new Y.Doc();

    Y.applyUpdate(doc, jest.mocked(updateCollab).mock.calls[0][3]);
    const content = yDocToSlateContent(doc)!;

    doc.destroy();
    return content;
  }

  it('persists parsed blocks through page creation and a real Yjs update, including embedded images', async () => {
    const image: ParsedBlock = {
      type: BlockType.ImageBlock,
      data: { url: 'data:image/png;base64,AA==', image_type: ImageType.External },
      text: '',
      formats: [],
      children: [],
    };

    jest
      .mocked(parseHTML)
      .mockReturnValue([paragraph, { ...image, data: { ...image.data } }, { ...image, data: { ...image.data } }]);
    jest.mocked(uploadFileMultipart).mockResolvedValue('https://storage.test/image.png');
    const result = await importHtmlFiles({ workspaceId: 'workspace', files: [htmlFile('Article.html')], createPage });

    expect(result).toEqual({ items: [{ fileName: 'Article.html', viewId: 'new-page' }], aborted: false });
    expect(createPage).toHaveBeenCalledWith('Article');
    expect(parseHTML).toHaveBeenCalledWith('<p>Article</p>', { preserveBlockStructure: true });
    expect(uploadFileMultipart).toHaveBeenCalledTimes(1);
    expect(uploadFileMultipart).toHaveBeenCalledWith({
      workspaceId: 'workspace',
      viewId: 'new-page',
      file: expect.any(File),
    });
    const content = savedContent();

    expect(Node.string(content)).toContain(paragraph.text);
    expect(content.children[0]).toMatchObject({
      children: [{ children: [{ text: 'Article', bold: true }, { text: ' 中文 — café.' }] }],
    });
    expect(content.children.slice(1)).toEqual([
      expect.objectContaining({
        type: BlockType.ImageBlock,
        data: expect.objectContaining({ url: 'https://storage.test/image.png', image_type: ImageType.Internal }),
      }),
      expect.objectContaining({
        type: BlockType.ImageBlock,
        data: expect.objectContaining({ url: 'https://storage.test/image.png', image_type: ImageType.Internal }),
      }),
    ]);
  });

  it('finishes saving an already created page after cancellation and does not start the next file', async () => {
    const controller = new AbortController();

    createPage.mockImplementationOnce(async () => {
      controller.abort();
      return { view_id: 'new-page' };
    });
    const result = await importHtmlFiles({
      workspaceId: 'workspace',
      files: [htmlFile('first.html'), htmlFile('next.html')],
      createPage,
      signal: controller.signal,
    });

    expect(result).toEqual({ items: [{ fileName: 'first.html', viewId: 'new-page' }], aborted: true });
    expect(createPage).toHaveBeenCalledTimes(1);
    expect(Node.string(savedContent())).toContain(paragraph.text);
  });

  it('preserves article text when a saved image contains malformed base64', async () => {
    const source = 'data:image/svg+xml;base64,not.valid.base64';

    jest.mocked(parseHTML).mockReturnValue([
      paragraph,
      {
        type: BlockType.ImageBlock,
        data: { url: source, image_type: ImageType.External },
        text: '',
        formats: [],
        children: [],
      },
    ]);
    const result = await importHtmlFiles({ workspaceId: 'workspace', files: [htmlFile('article.html')], createPage });

    expect(result.items[0].viewId).toBe('new-page');
    expect(uploadFileMultipart).not.toHaveBeenCalled();
    expect(Node.string(savedContent())).toContain(paragraph.text);
    expect(savedContent().children[1]).toMatchObject({ data: { url: source, image_type: ImageType.External } });
  });

  it('does not create a page when cancelled while the file is being read', async () => {
    const controller = new AbortController();
    const file = htmlFile('article.html');

    file.text.mockImplementationOnce(async () => {
      controller.abort();
      return '<p>Article</p>';
    });
    const result = await importHtmlFiles({
      workspaceId: 'workspace',
      files: [file],
      createPage,
      signal: controller.signal,
    });

    expect(result).toEqual({ items: [], aborted: true });
    expect(createPage).not.toHaveBeenCalled();
    expect(updateCollab).not.toHaveBeenCalled();
  });
});
