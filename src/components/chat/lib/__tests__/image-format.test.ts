import {
  buildResponseFormat,
  DEFAULT_IMAGE_OPTIONS,
  inferResponseFormatFromContent,
  isChatFileUrl,
} from '@/components/chat/lib/image-format';
import { OutputContent, OutputLayout } from '@/components/chat/types/request';

const BLOB_URL = 'https://cloud.example/api/file_storage/ws-1/v1/blob/chat-1/abc.png';

describe('isChatFileUrl', () => {
  it('recognizes the chat file storage blob path', () => {
    expect(isChatFileUrl(BLOB_URL)).toBe(true);
    expect(isChatFileUrl('https://example.com/second.png')).toBe(false);
  });
});

describe('inferResponseFormatFromContent', () => {
  it('treats an answer that is only a generated image as image-only', () => {
    expect(inferResponseFormatFromContent(`![Generated Image](${BLOB_URL})`)).toEqual({
      output_layout: OutputLayout.Flex,
      output_content: OutputContent.IMAGE,
    });
  });

  it('treats text followed by a generated image as text with image', () => {
    expect(inferResponseFormatFromContent(`A sunny meadow.\n![Generated Image](${BLOB_URL})`)).toEqual({
      output_layout: OutputLayout.Flex,
      output_content: OutputContent.RichTextImage,
    });
  });

  it('returns undefined for plain text and for images that were not generated', () => {
    expect(inferResponseFormatFromContent('Plain answer')).toBeUndefined();
    expect(inferResponseFormatFromContent('![web](https://example.com/web.png)')).toBeUndefined();
  });

  it('ignores a chat image quoted inside a code fence or written inline', () => {
    expect(inferResponseFormatFromContent('```md\n![Generated Image](' + BLOB_URL + ')\n```')).toBeUndefined();
    expect(inferResponseFormatFromContent('See ![Generated Image](' + BLOB_URL + ') here.')).toBeUndefined();
  });
});

describe('buildResponseFormat', () => {
  it('lets the model choose the layout in Auto mode', () => {
    expect(
      buildResponseFormat({
        formatMode: false,
        layout: OutputLayout.BulletList,
        content: OutputContent.TEXT,
        imageOptions: DEFAULT_IMAGE_OPTIONS,
      })
    ).toEqual({ output_layout: OutputLayout.Flex, output_content: OutputContent.TEXT });
  });

  it('sends the chosen layout in format mode', () => {
    expect(
      buildResponseFormat({
        formatMode: true,
        layout: OutputLayout.SimpleTable,
        content: OutputContent.TEXT,
        imageOptions: DEFAULT_IMAGE_OPTIONS,
      })
    ).toEqual({ output_layout: OutputLayout.SimpleTable, output_content: OutputContent.TEXT });
  });

  it('adds image metadata only for image answers and only for chosen options', () => {
    expect(
      buildResponseFormat({
        formatMode: false,
        layout: OutputLayout.Paragraph,
        content: OutputContent.IMAGE,
        imageOptions: { size: 'landscape', quality: 'hd', customImagePrompt: '  A fox in snow  ' },
      })
    ).toEqual({
      output_layout: OutputLayout.Flex,
      output_content: OutputContent.IMAGE,
      output_content_metadata: { size: '1536x1024', quality: 'hd', custom_image_prompt: 'A fox in snow' },
    });

    expect(
      buildResponseFormat({
        formatMode: false,
        layout: OutputLayout.Paragraph,
        content: OutputContent.RichTextImage,
        imageOptions: DEFAULT_IMAGE_OPTIONS,
      })
    ).toEqual({ output_layout: OutputLayout.Flex, output_content: OutputContent.RichTextImage });

    expect(
      buildResponseFormat({
        formatMode: false,
        layout: OutputLayout.Paragraph,
        content: OutputContent.TEXT,
        imageOptions: { size: 'square', quality: 'hd', customImagePrompt: 'ignored for text' },
      })
    ).toEqual({ output_layout: OutputLayout.Flex, output_content: OutputContent.TEXT });
  });
});
